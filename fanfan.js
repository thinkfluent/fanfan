// Config, Logger, Shutdown
const appConfig = require('./src/config.js');
const logger = require('./src/logger.js');
const shutdownHandler = require('./src/shutdown.js');

logger.debug(appConfig, 'Starting appConfig');

// Express app
const express = require('express');
const app = express();

// Cloud Run / HTTP load balancers take care of the access logging. But, in case needed.
if (appConfig.log_http) app.use(require('pino-http')({logger: logger}));
app.use(express.json({
    strict: true,  // JSON in & out
    limit: '10mb', // Pub/Sub max message size
}));
app.use(shutdownHandler.middleware()); // Delayed, graceful? async shutdown

// Routes -> actions
app.get('/healthy', require('./src/controllers/healthy.js'));
app.post('/job/fan-out', require('./src/controllers/job_fan_out.js'));
app.post('/task/done', require('./src/controllers/task_done.js'));
app.post('/task/dead', require('./src/controllers/task_dead_letter.js'));

// Start serving, register clean
const server = app.listen(parseInt(appConfig.port), () => {
    logger.info(`HTTP server listening on port ${appConfig.port}`);
});
shutdownHandler.register(() => server.close() );
