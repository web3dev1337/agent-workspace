const defaultSettings = {
  version: 'test',
  global: {
    ui: {
      theme: 'dark',
      visibility: {
        processBanner: true,
        header: {
          newProject: true,
          history: true,
          workflowMode: true,
          workflowBackground: true,
          tierFilters: true,
          focusTier2: true,
          focusSwap: true
        },
        dashboard: {
          processBanner: true
        }
      },
      tasks: {
        theme: 'inherit',
        boardMappings: {},
        kanban: { collapsedByBoard: {}, expandedByBoard: {}, layoutByBoard: {} },
        filters: { assigneesByBoard: {} },
        me: { trelloUsername: '' }
      }
    }
  },
  perTerminal: {}
};

const mergeSettings = (initial = {}) => ({
  ...defaultSettings,
  ...initial,
  global: {
    ...defaultSettings.global,
    ...(initial.global || {}),
    ui: {
      ...defaultSettings.global.ui,
      ...(initial.global?.ui || {}),
      visibility: {
        ...defaultSettings.global.ui.visibility,
        ...(initial.global?.ui?.visibility || {}),
        header: {
          ...defaultSettings.global.ui.visibility.header,
          ...(initial.global?.ui?.visibility?.header || {})
        },
        dashboard: {
          ...defaultSettings.global.ui.visibility.dashboard,
          ...(initial.global?.ui?.visibility?.dashboard || {})
        }
      },
      tasks: {
        ...defaultSettings.global.ui.tasks,
        ...(initial.global?.ui?.tasks || {}),
        kanban: {
          ...defaultSettings.global.ui.tasks.kanban,
          ...(initial.global?.ui?.tasks?.kanban || {})
        },
        filters: {
          ...defaultSettings.global.ui.tasks.filters,
          ...(initial.global?.ui?.tasks?.filters || {})
        },
        me: {
          ...defaultSettings.global.ui.tasks.me,
          ...(initial.global?.ui?.tasks?.me || {})
        }
      }
    }
  },
  perTerminal: {
    ...defaultSettings.perTerminal,
    ...(initial.perTerminal || {})
  }
});

const mockUserSettings = async (page, { initial } = {}) => {
  let settings = mergeSettings(initial || {
    version: 'test',
    global: {
      ui: {
        theme: 'dark'
      }
    },
    perTerminal: {}
  });

  await page.route('**/api/user-settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
  });

  await page.route('**/api/user-settings/global', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    settings = mergeSettings({
      ...settings,
      global: {
        ...settings.global,
        ...(body.global || {})
      }
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
  });
};

module.exports = { mockUserSettings };
