const appConfig = require('./config.js');
const logger = require('./logger.js');
const shutdownHandler = require('./shutdown.js');

const { createClient } = require('@redis/client');

// Redis setup // redis[s]://[[username][:password]@][host][:port][/db-number]:
const redisClient = createClient({
    url: `redis://${appConfig.redis_host}:${appConfig.redis_port}`
});
redisClient.on('error', err => logger.error(err, 'Redis Client Error'));
redisClient.connect().then(() => {
    logger.info('Redis connected OK');
    shutdownHandler.register(() => redisClient.disconnect() );
});

module.exports = redisClient;
