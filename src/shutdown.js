const logger = require('./logger.js');

let shuttingDown = false;
const callbacks = [];

module.exports.middleware = () => {
    return (req, res, next) => {
        if (shuttingDown) {
            logger.warn(`Rejecting new request (shutting down) with 503 to ${req.url}`);
            res.status(503).json({error:'shuttingDown'});
            return;
        }
        next();
    }
}

module.exports.register = (callback) => {
    callbacks.push(callback);
}

const gracefulShutdown = () => {
    shuttingDown = true;
    setTimeout(() => {
        logger.info(`Starting shutdown, ${callbacks.length} callbacks`);
        let promises = [];
        callbacks.forEach((promiseGen) => {
            promises.push(promiseGen());
        })
        Promise.all(promises).then(() => {
            logger.info('All shutdown steps complete');
            process.exit();
        });
    }, 5000);
}


// Signal handlers
const bailOut = function (signal) {
    logger.info(`Received ${signal}, requesting async shutdown`);
    gracefulShutdown();
}
process.on('SIGTERM', bailOut);
process.on('SIGINT', bailOut);