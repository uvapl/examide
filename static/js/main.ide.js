////////////////////////////////////////////////////////////////////////////////
// This file is the main entry point for the IDE app.
////////////////////////////////////////////////////////////////////////////////

// ===========================================================================
// Here's the start of the application.
// ===========================================================================

initApp().then(({ layout }) => {
  registerFileTreeEventListeners();
}).catch((err) => {
  console.error('Failed to bootstrap IDE app:', err);
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Initialise the app by loading the config and create the layout.
 *
 * @returns {Promise<{ layout: Layout }>} Object containing the layout instance.
 */
function initApp() {
  return new Promise((resolve, reject) => {
    // Get the programming language based on tabs filename.
    const proglang = 'c';

    // Initialise the programming language specific worker API.
    window._workerApi = new WorkerAPI(proglang);

    // Create the layout object.
    const layout = createLayout(proglang, {});

    // Call the init function that creates all components.
    layout.init();

    // Make layout instance available at all times.
    window._layout = layout;

    resolve({ layout });
  });
}


/**
 * Create the layout object with the given content objects and font-size.
 *
 * @param {array} content - List of content objects.
 * @param {string} proglang - The programming language to be used
 * @param {object} options - Additional options object.
 * @param {object} options.buttonConfig - Object containing buttons with their
 * commands that will be rendered by the layout.
 * @returns {Layout} The layout instance.
 */
function createLayout(proglang, options) {
  const defaultLayoutConfig = {
    settings: {
      showCloseIcon: false,
      showPopoutIcon: false,
      showMaximiseIcon: true,
      reorderEnabled: true,
    },
    dimensions: {
      headerHeight: 30,
      borderWidth: 10,
    },
    content: [
      {
        type: 'column',
        content: [
          {
            type: 'stack',
            content: [
              {
                type: 'component',
                componentName: 'editor',
                componentState: {
                  fontSize: BASE_FONT_SIZE,
                },
                title: 'main.c',
              },
              {
                type: 'component',
                componentName: 'editor',
                componentState: {
                  fontSize: BASE_FONT_SIZE,
                },
                title: 'README.md',
              },
            ],
          },
          {
            type: 'component',
            componentName: 'terminal',
            componentState: { fontSize: BASE_FONT_SIZE },
            isClosable: false,
          }
        ]
      }
    ]
  };

  return new LayoutIDE(proglang, defaultLayoutConfig, options);
}

/**
 * Open a file in the editor. When the file is already open, switch to the tab.
 *
 * @param {string} filename - The name of the file to open.
 */
function openFile(filename) {
  const tab = getAllEditorTabs().filter((tab) => tab.config.title === filename);
  if (tab.length > 0) {
    // Switch to the active tab.
    tab[0].parent.setActiveContentItem(tab[0]);
    tab[0].instance.editor.focus();
  } else {
    // Add a new tab next to the current active tab.
    getActiveEditor().parent.addChild({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize: BASE_FONT_SIZE,
      },
      title: filename,
    })
  }
}

/**
 * Registers all file tree event listeners
 */
function registerFileTreeEventListeners() {
  $('#file-tree .file').click((event) => {
    const filename = $(event.target).text();
    openFile(filename);
  });
}


