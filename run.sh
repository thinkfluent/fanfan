#!/bin/bash

if [[ -v REDIS_HOST ]]; then
  echo "Redis host set. Waiting."
  /usr/bin/wait-for "${REDIS_HOST}:${REDIS_PORT:-6379}" -- echo "Redis ready"
fi

if [[ -v PUBSUB_EMULATOR_HOST ]]; then
  echo "PubSub emulator host set. Waiting."
  /usr/bin/wait-for "${PUBSUB_EMULATOR_HOST}" -- echo "PubSub emulator ready"
  echo "Setting up topics, subscriptions"
  /usr/local/bin/node /app/scripts/setup_topics.js
fi

echo "Starting FanFan"
# if APP_MODE == development, use nodemon or Node.js inspect
if [[ "${APP_MODE}" = "development"  ]]; then
  if [[ -v NODE_INSPECT ]]; then
    echo "  with inspect"
    exec /usr/local/bin/node --disable-warning=DEP0040 --inspect=0.0.0.0 /app/fanfan.js
  else
    echo "  via node watch"
    exec /usr/local/bin/node --disable-warning=DEP0040 --watch-path=/app/ /app/fanfan.js
  fi
else
  exec /usr/local/bin/node --disable-warning=DEP0040 /app/fanfan.js
fi
