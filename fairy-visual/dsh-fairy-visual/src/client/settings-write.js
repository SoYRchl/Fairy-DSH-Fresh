const diagnostics = {
  error(operation, error, context = {}) {
    console.error(`DSH_FAIRY_LOG ${JSON.stringify({ schema: 1, timestamp: new Date().toISOString(), level: 'error', module: 'dsh-fairy-visual', operation, event: 'failure', context, error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 320) } })}`);
  },
};

function settingError(field, error) {
  diagnostics.error('settings.persist', error, { field });
}

function setControllerSetting(controller, field, value) {
  try {
    return Promise.resolve(controller.set(field, value));
  } catch (error) {
    return Promise.reject(error);
  }
}

function saveControllerSetting(controller, field, value) {
  return setControllerSetting(controller, field, value).catch((error) => {
    settingError(field, error);
    return undefined;
  });
}

module.exports = { setControllerSetting, saveControllerSetting, settingError };
