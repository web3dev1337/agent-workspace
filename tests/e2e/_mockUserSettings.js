const mockUserSettings = async (page, { initial } = {}) => {
  let settings = initial || {
    version: 'test',
    global: {
      ui: {
        theme: 'dark',
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

  await page.route('**/api/user-settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
  });

  await page.route('**/api/user-settings/global', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    settings = { ...settings, global: body.global || settings.global };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
  });
};

module.exports = { mockUserSettings };
