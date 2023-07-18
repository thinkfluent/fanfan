ARG YARN_PROD=true

###############################################################################
# Build some tooling we want later

FROM golang:latest as prebuilder

RUN apt update \
    && apt install curl git -y \
    && curl -s https://raw.githubusercontent.com/eficode/wait-for/master/wait-for -o /usr/bin/wait-for \
    && chmod +x /usr/bin/wait-for

# PubSub setup, with support for HTTP push subscriptions
RUN go install github.com/tomwalder/pubsubc@aded9416d1f3804a48a1371cb1d25aeab8073de1

###############################################################################
# We use the "vanilla" node image to do the install (it comes with git etc)


FROM node:20 as builder
ARG YARN_PROD
RUN mkdir -p /app
COPY ./package.json /app/
WORKDIR /app
RUN yarn install --production=${YARN_PROD}

###############################################################################
# We use the "slim" image for runtime, pulling in the node_modules from above

FROM node:20-slim

# Runtime environment
COPY ./run.sh /run.sh
RUN apt update && apt install netcat-openbsd -y && chmod +x /run.sh
COPY --from=prebuilder /usr/bin/wait-for /usr/bin
COPY --from=prebuilder /go/bin/pubsubc /usr/bin

# Application code
RUN mkdir -p /app
COPY . /app
COPY --from=builder /app/node_modules /app/node_modules

ENV APP_MODE production

WORKDIR /app
CMD ["/run.sh"]