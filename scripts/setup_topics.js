const appConfig = require('../src/config.js');
const logger = require('../src/logger.js');
const pubsub = require('../src/pubsub.js');
const client = pubsub.pubSubClient;

const topicIdBase = `projects/${appConfig.gcp_project}/topics`;
const subIdBase = `projects/${appConfig.gcp_project}/subscriptions`;

const buildTopicName = (topicSuffix) => {
    return `${topicIdBase}/${topicSuffix}`;
}

// @todo Handle default setup + overrides (i.e. custom JSON)
const pubSubSetup = require('./topics.json');

// First create all the topics (in case we need to use them as dead letter topics later)
const topicPromises = [];
for (const topicSuffix in pubSubSetup.topics) {
    const topicId = `${topicIdBase}/${topicSuffix}`;
    topicPromises.push(client.createTopic(topicId));
    console.log(`Creating topic [${topicId}]`);
}

// Once all topics are ready, start the subscriptions
Promise.all(topicPromises).then(() => {

    // Check push target overrides.
    let targets = {};
    targets.app = process.env.APP_PUSH_TARGET || pubSubSetup.hosts.app;
    targets.fanfan = process.env.FANFAN_PUSH_TARGET || pubSubSetup.hosts.fanfan;

    for (const topicSuffix in pubSubSetup.topics) {
        const topicId = buildTopicName(topicSuffix);
        const subs = pubSubSetup.topics[topicSuffix].subscriptions;
        for (const subSuffix in subs) {
            const subSpec = subs[subSuffix];
            const subId = `${subIdBase}/${subSuffix}`;
            const options = {
                ackDeadlineSeconds: 600,
                labels: {
                    "plugin": "fanfan"
                }
            };
            if (subSpec.type === "push") {
                options.pushConfig = {
                    pushEndpoint: targets[subSpec.host] + subSpec.target,
                    IOidcToken: {
                        serviceAccountEmail: "fanfan-invoker@"
                    }
                }
            }
            if (subSpec['dead-letter-topic']) {
                options.deadLetterPolicy = {
                    deadLetterTopic: buildTopicName(subSpec['dead-letter-topic']),
                    maxDeliveryAttempts: 5,
                };
            }
            client.topic(topicId).createSubscription(subId, options).then(() => {
                console.log(
                    `Subscription created [${subId}] (${subSpec.type})` +
                    (options.hasOwnProperty('deadLetterPolicy') ? ' w/DeadLetter' : '')
                );
            });
        }
    }
});
