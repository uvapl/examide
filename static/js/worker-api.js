/**
 * Bridge class between the main app and the currently loaded worker.
 */
class WorkerAPI {
  _proglang = null;
  _prevProglang = null;
  isRunningCode = false;
  isReady = false;
  sharedMem = null;

  constructor(proglang) {
    this.proglang = proglang;
    this._createWorker();
  }

  /**
   * Checks whether the browser enabled support for WebAssembly.Memory object
   * usage by trying to create a new SharedArrayBuffer object. This object can
   * only be created whenever both the Cross-Origin-Opener-Policy and
   * Cross-Origin-Embedder-Policy headers are set.
   *
   * @returns {boolean} True if browser supports shared memory, false otherwise.
   */
  hasSharedMemoryEnabled() {
    try {
      new SharedArrayBuffer(1024);
      return true;
    } catch (e) {
      return false;
    }
  }

  set proglang(newLang) {
    this._prevProglang = this.proglang;
    this._proglang = newLang;
  }

  get proglang() {
    return this._proglang;
  }

  /**
   * Terminate the existing worker process, hides term cursor and disposes any
   * active user input that is active.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  terminate(showTerminateMsg) {
    console.log(`Terminating existing ${this._prevProglang || this.proglang} worker`);

    this.isRunningCode = false;
    this.worker.terminate();
    this.runUserCodeCallback();

    // Disable the button and wait for the worker to remove the disabled prop
    // once it has been loaded.
    $('#run-code').prop('disabled', true);

    hideTermCursor();

    if (showTerminateMsg) {
      term.writeln('\x1b[1;31mProcess terminated\x1b[0m');
    }

    // Dispose any active user input.
    disposeUserInput();
  }

  /**
   * Creates a new worker process and terminates the existing worker if needed.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  _createWorker(showTerminateMsg) {
    this.isReady = false;

    $('#run-code').addClass('loading');

    if (this.worker) {
      this.terminate(showTerminateMsg);
    }

    console.log(`Spawning new ${this.proglang} worker`);

    this.worker = new Worker(this.getWorkerPath(this._proglang));
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onmessage.bind(this);
    const remotePort = channel.port2;
    const constructorData = { port: remotePort };

    if (this.hasSharedMemoryEnabled()) {
      this.sharedMem = new WebAssembly.Memory({
        initial: 1,
        maximum: 80,
        shared: true,
      });
      constructorData.sharedMem = this.sharedMem;
    }

    this.worker.postMessage({
      id: 'constructor',
      data: constructorData,
    }, [remotePort]);
  }

  /**
   * Triggers the `runUserCode` event in the currently active worker.
   *
   * @param {string} activeTabName - The name of the currently active tab.
   * @param {array} files - List of objects, each containing the filename
   * and content of the corresponding editor tab.
   */
  runUserCode(activeTabName, files) {
    this.isRunningCode = true;

    this.port.postMessage({
      id: 'runUserCode',
      data: { activeTabName, files },
    });
  }

  /**
   * Triggers the `runButtonCommand` event in the currently active worker.
   *
   * @param {string} selector - Unique selector for the button, used to disable
   * it when running and disable it when it's done running.
   * @param {string} activeTabName - The name of the currently active tab.
   * @param {array} cmd - List of commands to execute.
   * @param {array} files - List of objects, each containing the filename and
   * content of the corresponding editor tab.
   */
  runButtonCommand(selector, activeTabName, cmd, files) {
    this.port.postMessage({
      id: 'runButtonCommand',
      data: { selector, activeTabName, cmd, files },
    });
  }

  /**
   * Get the path to the worker file given a programming language.
   *
   * @param {string} proglang - The programming language to get the worker path for.
   * @returns {string} Path to the worker file.
   */
  getWorkerPath(proglang) {
    let name = proglang;

    if (proglang === 'c') {
      name = 'clang';
    }

    return `static/js/workers/${name}.worker.js`;
  }

  /**
   * Terminate the code that is being run by the user. Useful when e.g. an
   * infinite loop is detected. This process terminates the existing worker and
   * create a complete new instance.
   *
   * @param {boolean} [showTerminateMsg] - Print a message in the terminal
   * indicating the current worker process has been terminated.
   */
  restart(showTerminateMsg) {
    this._createWorker(showTerminateMsg);
  }

  /**
   * Callback function for when the user code has finished running or has been
   * terminated by the user.
   */
  runUserCodeCallback() {
    this.isRunningCode = false;

    // Change the stop-code button back to a run-code button.
    const $button = $('#run-code');
    const newText = $button.text().replace('Stop', 'Run');
    $button.text(newText)
      .prop('disabled', false)
      .addClass('run-code-btn')
      .removeClass('danger-btn');

    if (window._showStopCodeButtonTimeoutId) {
      clearTimeout(window._showStopCodeButtonTimeoutId);
      window._showStopCodeButtonTimeoutId = null;
    }
  }

  /**
   * Message event handler for the worker.
   *
   * @param {object} event - Event object coming from the UI.
   */
  onmessage(event) {
    switch (event.data.id) {

      // Ready callback from the worker instance. This will be run after
      // everything has been initialised and ready to run some code.
      case 'ready':
        this.isReady = true;
        $('.lm_header .button').prop('disabled', false);
        $('#run-code').removeClass('loading');
        break;

      // Write callback from the worker instance. When the worker wants to write
      // code the terminal, this event will be triggered.
      case 'write':
        term.write(event.data.data);
        break;

      // Stdin callback from the worker instance. When the worker requests user
      // input, this event will be triggered. The user input will be requested
      // and sent back to the worker through the usage of shared memory.
      case 'readStdin':
        waitForInput().then((value) => {
          const view = new Uint8Array(this.sharedMem.buffer);
          for (let i = 0; i < value.length; i++) {
            // To the shared memory.
            view[i] = value.charCodeAt(i);
          }

          // Set the last byte to the null terminator.
          view[value.length] = 0;

          Atomics.notify(new Int32Array(this.sharedMem.buffer), 0);
        });
        break;

      // Run custom config button callback from the worker instance.
      // This event will be triggered after a custom config button's command has
      // been executed.
      case 'runButtonCommandCallback':
        $(event.data.selector).prop('disabled', false);
        break;

      // Run user code callback from the worker instance. This event will be
      // triggered after excecuting the user's code.
      case 'runUserCodeCallback':
        this.runUserCodeCallback();
        break;
    }
  }
}

/**
 * Check whether a given proglang has a corresponding worker implementation.
 *
 * @param {string} proglang - The proglang to check for.
 * @returns {boolean} True if proglang is valid, false otherwise.
 */
function hasWorker(proglang) {
  const whitelist = ['c', 'py'];
  return whitelist.some((lang) => proglang === lang);
}

/**
 * Create a new worker API instance if none exists already. The existing
 * instance will be terminated and restarted if necessary.
 *
 * @param {string} proglang - The proglang to spawn the related worker for.
 */
function createWorkerApi(proglang) {
  // Situation 1: no worker, thus spawn a new one.
  if (!window._workerApi && hasWorker(proglang)) {
    window._workerApi = new WorkerAPI(proglang);
  } else if (window._workerApi && window._workerApi.proglang !== proglang) {
    window._workerApi.proglang = proglang;

    // Situation 2: existing worker but new proglang is invalid.
    if (!hasWorker(proglang)) {
      window._workerApi.terminate();
      window._workerApi = null;
    } else {
      // Situation 3: existing worker and new proglang is valid.
      window._workerApi.restart();
    }
  }
}
