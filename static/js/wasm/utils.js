/*
 * Copyright 2020 WebAssembly Community Group participants
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function setLocalStorageItem(key, value) {
  localStorage.setItem(`${LOCAL_STORAGE_PREFIX}-${key}`, value);
}

function getLocalStorageItem(key, defaultValue) {
  const value = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}-${key}`);
  return typeof value === 'undefined' && typeof defaultValue !== 'undefined' ? defaultValue : value;
}

function sleep(ms) {
  return new Promise((resolve, _) => setTimeout(resolve, ms));
}

function readStr(u8, o, len = -1) {
  let str = '';
  let end = u8.length;
  if (len != -1)
    end = o + len;
  for (let i = o; i < end && u8[i] != 0; ++i)
    str += String.fromCharCode(u8[i]);
  return str;
}

function debounceLazy(f, ms) {
  let waiting = 0;
  let running = false;

  const wait = async () => {
    ++waiting;
    await sleep(ms);
    return --waiting === 0;
  };

  const wrapped = async (...args) => {
    if (await wait()) {
      while (running) await wait();
      running = true;
      try {
        await f(...args);
      } finally {
        running = false;
      }
    }
  };
  return wrapped;
}

const API = (function() {

  class ProcExit extends Error {
    constructor(code) {
      super(`process exited with code ${code}.`);
      this.code = code;
    }
  };

  class NotImplemented extends Error {
    constructor(modname, fieldname) {
      super(`${modname}.${fieldname} not implemented.`);
    }
  }

  class AbortError extends Error {
    constructor(msg = 'abort') { super(msg); }
  }

  class AssertError extends Error {
    constructor(msg) { super(msg); }
  }

  function assert(cond) {
    if (!cond) {
      throw new AssertError('assertion failed.');
    }
  }

  function getInstance(module, imports) {
    return WebAssembly.instantiate(module, imports);
  }

  function getImportObject(obj, names) {
    const result = {};
    for (let name of names) {
      result[name] = obj[name].bind(obj);
    }
    return result;
  }

  const ESUCCESS = 0;

  class Memory {
    constructor(memory) {
      this.memory = memory;
      this.buffer = this.memory.buffer;
      this.u8 = new Uint8Array(this.buffer);
      this.u32 = new Uint32Array(this.buffer);
    }

    check() {
      if (this.buffer.byteLength === 0) {
        this.buffer = this.memory.buffer;
        this.u8 = new Uint8Array(this.buffer);
        this.u32 = new Uint32Array(this.buffer);
      }
    }

    read8(o) { return this.u8[o]; }
    read32(o) { return this.u32[o >> 2]; }
    write8(o, v) { this.u8[o] = v; }
    write32(o, v) { this.u32[o >> 2] = v; }
    write64(o, vlo, vhi = 0) { this.write32(o, vlo); this.write32(o + 4, vhi); }

    readStr(o, len) {
      return readStr(this.u8, o, len);
    }

    // Null-terminated string.
    writeStr(o, str) {
      o += this.write(o, str);
      this.write8(o, 0);
      return str.length + 1;
    }

    write(o, buf) {
      if (buf instanceof ArrayBuffer) {
        return this.write(o, new Uint8Array(buf));
      } else if (typeof buf === 'string') {
        return this.write(o, buf.split('').map(x => x.charCodeAt(0)));
      } else {
        const dst = new Uint8Array(this.buffer, o, buf.length);
        dst.set(buf);
        return buf.length;
      }
    }
  };

  class MemFS {
    constructor(options) {
      const compileStreaming = options.compileStreaming;
      this.hostWrite = options.hostWrite;
      this.hostRead = options.hostRead;
      this.stdinStr = options.stdinStr || '';
      this.stdinStrPos = 0;
      this.sharedMem = options.sharedMem;
      this.memfsFilename = options.memfsFilename;

      this.hostMem_ = null;  // Set later when wired up to application.

      // Imports for memfs module.
      const env = getImportObject(
        this, ['abort', 'host_write', 'host_read', 'memfs_log', 'copy_in', 'copy_out']);

      this.ready = compileStreaming(this.memfsFilename)
        .then(module => WebAssembly.instantiate(module, { env }))
        .then(instance => {
          this.instance = instance;
          this.exports = instance.exports;
          this.mem = new Memory(this.exports.memory);
          this.exports.init();
        })
    }

    set hostMem(mem) {
      this.hostMem_ = mem;
    }

    setStdinStr(str) {
      this.stdinStr = str;
      this.stdinStrPos = 0;
    }

    addDirectory(path) {
      this.mem.check();
      this.mem.write(this.exports.GetPathBuf(), path);
      this.exports.AddDirectoryNode(path.length);
    }

    addFile(path, contents) {
      const length =
        contents instanceof ArrayBuffer ? contents.byteLength : contents.length;
      this.mem.check();
      this.mem.write(this.exports.GetPathBuf(), path);
      const inode = this.exports.AddFileNode(path.length, length);
      const addr = this.exports.GetFileNodeAddress(inode);
      this.mem.check();
      this.mem.write(addr, contents);
    }

    getFileContents(path) {
      this.mem.check();
      this.mem.write(this.exports.GetPathBuf(), path);
      const inode = this.exports.FindNode(path.length);
      const addr = this.exports.GetFileNodeAddress(inode);
      const size = this.exports.GetFileNodeSize(inode);
      return new Uint8Array(this.mem.buffer, addr, size);
    }

    abort() { throw new AbortError(); }

    host_write(fd, iovs, iovs_len, nwritten_out) {
      this.hostMem_.check();
      assert(fd <= 2);
      let size = 0;
      let str = '';
      for (let i = 0; i < iovs_len; ++i) {
        const buf = this.hostMem_.read32(iovs);
        iovs += 4;
        const len = this.hostMem_.read32(iovs);
        iovs += 4;
        str += this.hostMem_.readStr(buf, len);
        size += len;
      }
      this.hostMem_.write32(nwritten_out, size);
      this.hostWrite(str);
      return ESUCCESS;
    }

    host_read(fd, iovs, iovs_len, nread) {
      let str = '';

      this.hostRead();
      Atomics.wait(new Int32Array(this.sharedMem.buffer), 0, 0);

      // Read the value stored in memory.
      const sharedMem = new Uint8Array(this.sharedMem.buffer);
      for (let i = 0; ; i++) {
        if (sharedMem[i] === 0) {
          // Null terminator found, terminate the loop.
          break;
        }

        str += String.fromCharCode(sharedMem[i]);
      }

      this.setStdinStr(str);

      // Clean shared memory.
      sharedMem.fill(0);

      this.hostMem_.check();
      assert(fd === 0);

      let size = 0;
      for (let i = 0; i < iovs_len; ++i) {
        const buf = this.hostMem_.read32(iovs);
        iovs += 4;
        const len = this.hostMem_.read32(iovs);
        iovs += 4;
        const lenToWrite = Math.min(len, (this.stdinStr.length - this.stdinStrPos));
        if (lenToWrite === 0) {
          break;
        }

        this.hostMem_.write(buf, this.stdinStr.substr(this.stdinStrPos, lenToWrite));
        size += lenToWrite;
        this.stdinStrPos += lenToWrite;

        if (lenToWrite !== len) {
          break;
        }
      }

      this.hostMem_.write32(nread, size);
      return ESUCCESS;
    }

    memfs_log(buf, len) {
      this.mem.check();
      console.log(this.mem.readStr(buf, len));
    }

    copy_out(clang_dst, memfs_src, size) {
      this.hostMem_.check();
      const dst = new Uint8Array(this.hostMem_.buffer, clang_dst, size);
      this.mem.check();
      const src = new Uint8Array(this.mem.buffer, memfs_src, size);
      dst.set(src);
    }

    copy_in(memfs_dst, clang_src, size) {
      this.mem.check();
      const dst = new Uint8Array(this.mem.buffer, memfs_dst, size);
      this.hostMem_.check();
      const src = new Uint8Array(this.hostMem_.buffer, clang_src, size);
      dst.set(src);
    }
  }

  const RAF_PROC_EXIT_CODE = 0xC0C0A;

  class App {
    constructor(module, memfs, name, ...args) {
      this.argv = [name, ...args];
      this.environ = { USER: 'alice' };
      this.memfs = memfs;
      this.allowRequestAnimationFrame = true;
      this.handles = new Map();
      this.nextHandle = 0;

      const env = getImportObject(this, []);

      const wasi_unstable = getImportObject(this, [
        'proc_exit', 'environ_sizes_get', 'environ_get', 'args_sizes_get',
        'args_get', 'random_get', 'clock_time_get', 'poll_oneoff'
      ]);

      // Fill in some WASI implementations from memfs.
      Object.assign(wasi_unstable, this.memfs.exports);

      this.ready = getInstance(module, { wasi_unstable, env }).then(instance => {
        this.instance = instance;
        this.exports = this.instance.exports;
        this.mem = new Memory(this.exports.memory);
        this.memfs.hostMem = this.mem;
      });
    }

    async run() {
      await this.ready;
      try {
        this.exports._start();
      } catch (exn) {
        let writeStack = true;
        if (exn instanceof ProcExit) {
          if (exn.code === RAF_PROC_EXIT_CODE) {
            console.log('Allowing rAF after exit.');
            return true;
          }
          // Don't allow rAF unless you return the right code.
          console.log(`Disallowing rAF since exit code is ${exn.code}.`);
          this.allowRequestAnimationFrame = false;
          if (exn.code == 0) {
            return false;
          }
          writeStack = false;
        }

        // Write error message.
        let msg = `\x1b[91mError: ${exn.message}`;
        if (writeStack) {
          msg = msg + `\n${exn.stack}`;
        }
        msg += '\x1b[0m\n';
        this.memfs.hostWrite(msg);

        // Propagate error.
        throw exn;
      }
    }

    proc_exit(code) {
      throw new ProcExit(code);
    }

    environ_sizes_get(environ_count_out, environ_buf_size_out) {
      this.mem.check();
      let size = 0;
      const names = Object.getOwnPropertyNames(this.environ);
      for (const name of names) {
        const value = this.environ[name];
        // +2 to account for = and \0 in "name=value\0".
        size += name.length + value.length + 2;
      }
      this.mem.write64(environ_count_out, names.length);
      this.mem.write64(environ_buf_size_out, size);
      return ESUCCESS;
    }

    environ_get(environ_ptrs, environ_buf) {
      this.mem.check();
      const names = Object.getOwnPropertyNames(this.environ);
      for (const name of names) {
        this.mem.write32(environ_ptrs, environ_buf);
        environ_ptrs += 4;
        environ_buf +=
          this.mem.writeStr(environ_buf, `${name}=${this.environ[name]}`);
      }
      this.mem.write32(environ_ptrs, 0);
      return ESUCCESS;
    }

    args_sizes_get(argc_out, argv_buf_size_out) {
      this.mem.check();
      let size = 0;
      for (let arg of this.argv) {
        size += arg.length + 1;  // "arg\0".
      }
      this.mem.write64(argc_out, this.argv.length);
      this.mem.write64(argv_buf_size_out, size);
      return ESUCCESS;
    }

    args_get(argv_ptrs, argv_buf) {
      this.mem.check();
      for (let arg of this.argv) {
        this.mem.write32(argv_ptrs, argv_buf);
        argv_ptrs += 4;
        argv_buf += this.mem.writeStr(argv_buf, arg);
      }
      this.mem.write32(argv_ptrs, 0);
      return ESUCCESS;
    }

    random_get(buf, buf_len) {
      const data = new Uint8Array(this.mem.buffer, buf, buf_len);
      for (let i = 0; i < buf_len; ++i) {
        data[i] = (Math.random() * 256) | 0;
      }
    }

    clock_time_get(clock_id, precision, time_out) {
      throw new NotImplemented('wasi_unstable', 'clock_time_get');
    }

    poll_oneoff(in_ptr, out_ptr, nsubscriptions, nevents_out) {
      throw new NotImplemented('wasi_unstable', 'poll_oneoff');
    }
  }

  class Tar {
    constructor(buffer) {
      this.u8 = new Uint8Array(buffer);
      this.offset = 0;
    }

    readStr(len) {
      const result = readStr(this.u8, this.offset, len);
      this.offset += len;
      return result;
    }

    readOctal(len) {
      return parseInt(this.readStr(len), 8);
    }

    alignUp() {
      this.offset = (this.offset + 511) & ~511;
    }

    readEntry() {
      if (this.offset + 512 > this.u8.length) {
        return null;
      }

      const entry = {
        filename: this.readStr(100),
        mode: this.readOctal(8),
        owner: this.readOctal(8),
        group: this.readOctal(8),
        size: this.readOctal(12),
        mtim: this.readOctal(12),
        checksum: this.readOctal(8),
        type: this.readStr(1),
        linkname: this.readStr(100),
      };

      if (this.readStr(8) !== 'ustar  ') {
        return null;
      }

      entry.ownerName = this.readStr(32);
      entry.groupName = this.readStr(32);
      entry.devMajor = this.readStr(8);
      entry.devMinor = this.readStr(8);
      entry.filenamePrefix = this.readStr(155);
      this.alignUp();

      if (entry.type === '0') {        // Regular file.
        entry.contents = this.u8.subarray(this.offset, this.offset + entry.size);
        this.offset += entry.size;
        this.alignUp();
      } else if (entry.type !== '5') { // Directory.
        console.log('type', entry.type);
        assert(false);
      }
      return entry;
    }

    untar(memfs) {
      let entry;
      while (entry = this.readEntry()) {
        switch (entry.type) {
          case '0': // Regular file.
            memfs.addFile(entry.filename, entry.contents);
            break;
          case '5': // Directory.
            memfs.addDirectory(entry.filename);
            break;
        }
      }
    }
  }

  class API {
    constructor(options) {
      this.moduleCache = {};
      this.readBuffer = options.readBuffer;
      this.compileStreaming = options.compileStreaming;
      this.hostWrite = options.hostWrite;
      this.hostRead = options.hostReadLine;
      this.clangFilename = options.clang || 'clang';
      this.lldFilename = options.lld || 'lld';
      this.sharedMem = options.sharedMem;
      this.sysrootFilename = options.sysroot || 'sysroot.tar';

      this.clangCommonArgs = [
        '-disable-free',
        '-isysroot', '/',
        '-internal-isystem', '/include/c++/v1',
        '-internal-isystem', '/include',
        '-internal-isystem', '/lib/clang/8.0.1/include',
        '-ferror-limit', '19',
        '-fmessage-length', '80',
        '-fcolor-diagnostics',
      ];

      this.memfs = new MemFS({
        compileStreaming: this.compileStreaming,
        hostWrite: this.hostWrite,
        hostRead: this.hostRead,
        sharedMem: this.sharedMem,
        memfsFilename: options.memfs || 'memfs',
      });
      this.ready = this.memfs.ready.then(() => {
        return this.untar(this.sysrootFilename);
      });
    }

    hostLog(message) {
      this.hostWrite(`\$ ${message}`);
    }

    async hostLogAsync(message, promise) {
      this.hostLog(`${message}...`);
      const result = await promise;
      this.hostWrite('done.\n');
      return result;
    }

    async getModule(name) {
      if (this.moduleCache[name]) return this.moduleCache[name];
      const module = await this.compileStreaming(name);
      this.moduleCache[name] = module;
      return module;
    }

    async untar(filename) {
      await this.memfs.ready;
      const tar = new Tar(await this.readBuffer(filename));
      tar.untar(this.memfs);
    }

    async compile(options) {
      const input = options.input;
      const contents = options.contents;
      const obj = options.obj;

      await this.ready;
      this.memfs.addFile(input, contents);
      const clang = await this.getModule(this.clangFilename);
      return await this.run([
        clang, 'clang', '-cc1', '-emit-obj',
        ...this.clangCommonArgs, '-O2', '-o', obj, '-x',
        'c++', input
      ], { hostLog: false });
    }

    async link(obj, wasm) {
      const stackSize = 1024 * 1024;

      const libdir = 'lib/wasm32-wasi';
      const crt1 = `${libdir}/crt1.o`;
      await this.ready;
      const lld = await this.getModule(this.lldFilename);
      return await this.run([
        lld, 'wasm-ld', '--no-threads',
        '--export-dynamic',
        '-z', `stack-size=${stackSize}`, `-L${libdir}`, crt1, obj, '-lc',
        '-lc++', '-lc++abi', '-o', wasm
        ]);
    }

    async run(cmd) {
      const [ module, ...args ] = cmd;
      const app = new App(module, this.memfs, ...args);
      const stillRunning = await app.run();
      return stillRunning ? app : null;
    }

    async compileLinkRun(data) {
      const { filename, contents } = data;
      const input = `test.cc`;
      const obj = `test.o`;
      const wasm = `test.wasm`;

      const promise = (async () => {
        await this.compile({ input, contents, obj });
        await this.link(obj, wasm);
        const buffer = this.memfs.getFileContents(wasm);
        return WebAssembly.compile(buffer)
      })();
      const testMod = await this.hostLogAsync(`Compiling ${filename}`, promise);

      this.hostWrite(`\$ ./${filename.replace(/\.c/, '')}\n`);
      const result = await this.run([testMod, wasm]);
      this.hostWrite('\n');
      return result;
    }
  }

  return API;

})();
