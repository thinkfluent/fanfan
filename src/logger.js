const appConfig = require("./config.js");
const pino = require("pino");
const loggerConfig = {
    level: appConfig.log_level,
};
if ('development' === appConfig.app_mode) {
    loggerConfig.transport = {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    };
}
module.exports = pino(loggerConfig);