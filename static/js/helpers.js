/**
 * Set a given key and value in the local storage.
 *
 * @param {string} key - The key to be used.
 * @param {string} value - The value to set under the given key.
 */
function setLocalStorageItem(key, value) {
  localStorage.setItem(`${LOCAL_STORAGE_PREFIX}-${key}`, value);
}

/**
 * Get a given key from the local storage.
 *
 * @param {string} key - The key to look for.
 * @param {string} defaultValue - The default value to return if the key is not found.
 * @returns {*} The value from the local storage or the default value.
 */
function getLocalStorageItem(key, defaultValue) {
  const value = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}-${key}`);
  return value === null && typeof defaultValue !== 'undefined' ? defaultValue : value;
}

/**
 * Remove a given key from the local storage.
 *
 * @param {string} key - The key to remove.
 */
function removeLocalStorageItem(key) {
  localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}-${key}`);
}

/**
 * Check whether an object is a real object, because essentially, everything
 * is an object in JavaScript.
 *
 * @param {object} obj - The object to validate.
 * @returns {boolean} True if the given object is a real object.
 */
function isObject(obj) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Prefix the given number with a zero if below 10.
 *
 * @param {string|number} num - The number to be prefixed.
 * @returns {string|number} Returns the original if above 10, otherwise it will
 * return a string prefixed with a zero.
 */
function prefixZero(num) {
  return num < 10 ? '0' + num : num;
}

/**
 * Format a given date object to a human-readable format.
 *
 * @param {Date} date - The date object to use.
 * @returns {string} Formatted string in human-readable format.
 */
function formatDate(date) {
  const hours = prefixZero(date.getHours());
  const minutes = prefixZero(date.getMinutes());
  return hours + ':' + minutes;
}

/**
 * Wrapper function to render a notification as an error type.
 *
 * @param {string} msg - The message to be displayed.
 * @param {object} options - Additional options for the notification.
 */
function notifyError(msg, options) {
  notify(msg, { ...options, type: 'error' });
}

/**
 * Render a given message inside the notification container in the UI.
 *
 * @param {string} msg - The message to be displayed.
 * @param {object} options - Additional options for the notification.
 * @param {string} options.type - The type of notification (e.g. 'error').
 * @param {number} options.fadeOutAfterMs - The time in milliseconds to fade.
 */
function notify(msg, options = {}) {
  if (window.notifyTimeoutId !== null) {
    clearTimeout(window.notifyTimeoutId);
    window.notifyTimeoutId = null;
  }

  const $msgContainer = $('.msg-container');

  if (options.type === 'error') {
    $msgContainer.addClass('error');
  }

  $msgContainer.html(`<span>${msg}</span>`);

  if (options.fadeOutAfterMs) {
    window.notifyTimeoutId = setTimeout(() => {
      $('.msg-container span').fadeOut();
    }, options.fadeOutAfterMs);
  }
}

/**
 * Parse the query parameters from the window.location.search.
 *
 * @returns {object} A key-value object with all the query params.
 */
function parseQueryParams() {
  const queryString = window.location.search.substring(1);
  if (!queryString) return {};

  return queryString
    .split('&')
    .reduce((obj, param) => {
      const [key, value] = param.split('=');
      obj[key] = value;
      return obj;
    }, {});
}

/**
 * Check whether a given object contains specific keys.
 *
 * @param {object} obj - The object to check.
 * @param {array} keys - A list of keys the object is required to have.
 * @returns {boolean} True when the object contains all keys specified.
 */
function objectHasKeys(obj, keys) {
  for (let key of keys) {
    if (typeof obj[key] === 'undefined') return false;
  }

  return true;
}

/**
 * Check whether a given URL is valid by checking if it starts with either
 * `http://` or `https://`
 *
 * @param {string} url - The URL to be checked.
 * @returns {boolean} True when the url is valid.
 */
function isValidUrl(url) {
  return /^https:?\/\//g.test(url);
}

/**
 * Generate a random integer between a lower and upper bound, both inclusive.
 *
 * @param {number} lower - The lower bound.
 * @param {number} upper - The uppper bound.
 * @returns {number} Random integer between the specified bounds.
 */
function getRandNumBetween(lower, upper) {
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

/**
 * Check whether the current user OS is Mac.
 *
 * @returns {boolean} True when the system is detected as a Mac-like system.
 */
function isMac() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

/**
 * Make a url with a given query params object.
 *
 * @param {string} url - The URL where the query params will be appended to.
 * @param {object} queryParams - The params that will be converted to the URL.
 * @returns {string} A concatenation of the URL and query params.
 */
function makeUrl(url, queryParams) {
  const query = Object.keys(queryParams)
    .reduce((query, key) => query.concat(`${key}=${queryParams[key]}`), [])
    .join('&');

  return `${url}?${query}`;
}

/**
 * Update the local storage prefix with an additional key.
 *
 * @param {string} additionalKey - An additional prefix that will be appended to
 * the current local storage prefix.
 */
function updateLocalStoragePrefix(additionalKey) {
  LOCAL_STORAGE_PREFIX = `${DEFAULT_LOCAL_STORAGE_PREFIX}-${additionalKey}`;
}

/**
 * Converts a string to be a local storage suitable key by replacing
 * non-suitable characters with a hyphen.
 *
 * @param {string} key - The key to convert.
 * @returns {string} A local storage suitable key.
 */
function makeLocalStorageKey(key) {
  return key.replace(/[^0-9a-z]+/g, '-');
}

/**
 * Remove the minimum indent at a given string.
 *
 * @param {string} text - The input string.
 * @returns {str} Modified string with minimum indent removed.
 */
function removeIndent(text) {
  // Remove leading newlines.
  while (text.startsWith('\n')) {
    text = text.slice(1);
  }

  // Remove trailing newlines.
  text = text.replace(/([\n\s])*$/, '');

  // Get the minimum indentation.
  const indent = text.match(/^[\s\t]*/)[0];

  // Remove minimum indent from each line.
  return text
    .split('\n')
    .map(line => line.replace(new RegExp(`^${indent}`), ''))
    .join('\n');
}
