const appConfig = require('./config.js');
const { PubSub } = require('@google-cloud/pubsub');

// PubSub setup
const pubSubClient = new PubSub({projectId: appConfig.gcp_project});
const topicMap = new Map();

// Topic factory / store
module.exports.getTopic = (topicName) => {
    if (!topicMap.has(topicName)) {
        topicMap.set(topicName, pubSubClient.topic(topicName));
    }
    return topicMap.get(topicName);
};

// Extract PubSub data util
module.exports.extractPubSub = function (message) {
    return [
        message.attributes,
        JSON.parse(
            Buffer.from(
                message.data,
                'base64'
            ).toString()
        )
    ];
}

// In case we need direct access
module.exports.pubSubClient = pubSubClient;