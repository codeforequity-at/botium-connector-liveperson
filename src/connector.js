const util = require('util')
const _ = require('lodash')
const randomize = require('randomatic')
const debug = require('debug')('botium-connector-liveperson')
const { getDomainByServiceName, getAccessToken, getJwsToken, openConversation, closeConversation } = require('./helper')

const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const { Capabilities: CoreCapabilities } = require('botium-core')

const ASYNC_MESSAGING_SERVICE_NAME = 'asyncMessagingEnt'

const Capabilities = {
  LIVEPERSON_CLIENT_ID: 'LIVEPERSON_CLIENT_ID',
  LIVEPERSON_CLIENT_SECRET: 'LIVEPERSON_CLIENT_SECRET',
  LIVEPERSON_ACCOUNT_ID: 'LIVEPERSON_ACCOUNT_ID',
  LIVEPERSON_SKILL_ID: 'LIVEPERSON_SKILL_ID',
  LIVEPERSON_AUTO_MESSAGES_FEATURE: 'LIVEPERSON_AUTO_MESSAGES_FEATURE',
  LIVEPERSON_QUICK_REPLIES_FEATURE: 'LIVEPERSON_QUICK_REPLIES_FEATURE',
  LIVEPERSON_RICH_CONTENT_FEATURE: 'LIVEPERSON_RICH_CONTENT_FEATURE',
  LIVEPERSON_MULTI_DIALOG_FEATURE: 'LIVEPERSON_MULTI_DIALOG_FEATURE',
  LIVEPERSON_USER_PROFILE: 'LIVEPERSON_USER_PROFILE'
}

class BotiumConnectorLivePerson {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
    this.delegateContainer = null
    this.delegateCaps = null
    this.conversationId = null
  }

  async Validate () {
    debug('Validate called')

    this.caps = Object.assign({}, this.caps)

    if (!this.caps[Capabilities.LIVEPERSON_CLIENT_ID]) throw new Error('LIVEPERSON_CLIENT_ID capability required')
    if (!this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET]) throw new Error('LIVEPERSON_CLIENT_SECRET capability required')
    if (!this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID]) throw new Error('LIVEPERSON_ACCOUNT_ID capability required')

    if (!this.delegateContainer) {
      this.visitorId = 'A3ZTY3Zjk1MDExZTczYTU4'

      const messagingDomain = await getDomainByServiceName(ASYNC_MESSAGING_SERVICE_NAME, this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID])
      if (!messagingDomain) throw new Error(`Can't find domain for '${ASYNC_MESSAGING_SERVICE_NAME}' service`)

      this.delegateCaps = {
        [CoreCapabilities.SIMPLEREST_URL]: `https://${messagingDomain}/api/account/${this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID]}/messaging/consumer/conversation/send?v=3`,
        [CoreCapabilities.SIMPLEREST_METHOD]: 'POST',
        [CoreCapabilities.SIMPLEREST_BODY_TEMPLATE]:
          `{
            "userId": "{{botium.conversationId}}",
            "messagePayload": {
            }
          }`,
        [CoreCapabilities.SIMPLEREST_START_HOOK]: async ({ context }) => {
          const params = {
            clientId: this.caps[Capabilities.LIVEPERSON_CLIENT_ID],
            clientSecret: this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET],
            accountId: this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID],
            skillId: this.caps[Capabilities.LIVEPERSON_SKILL_ID],
            autoMessages: this.caps[Capabilities.LIVEPERSON_AUTO_MESSAGES_FEATURE],
            quickReplies: this.caps[Capabilities.LIVEPERSON_QUICK_REPLIES_FEATURE],
            multiDialog: this.caps[Capabilities.LIVEPERSON_MULTI_DIALOG_FEATURE],
            richContent: this.caps[Capabilities.LIVEPERSON_RICH_CONTENT_FEATURE],
            userProfile: this.caps[Capabilities.LIVEPERSON_USER_PROFILE]
          }
          const conversationId = await openConversation(params)
          if (!conversationId) throw new Error('Can not open conversation')
          context.conversationId = conversationId
        },
        [CoreCapabilities.SIMPLEREST_BODY_TEMPLATE]:
          `{
            "kind": "req",
            "id": ${randomize('0', 10)},
            "type": "ms.PublishEvent"
          }`,
        [CoreCapabilities.SIMPLEREST_REQUEST_HOOK]: async ({ requestOptions, msg, context }) => {
          const clientId = this.caps[Capabilities.LIVEPERSON_CLIENT_ID]
          const clientSecret = this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET]
          const accountId = this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID]
          const clientProperties = {
            type: 'ClientProperties',
            features: []
          }
          // if (this.caps[Capabilities.LIVEPERSON_AUTO_MESSAGES_FEATURE]) clientProperties.features.push('AUTO_MESSAGES')
          if (this.caps[Capabilities.LIVEPERSON_QUICK_REPLIES_FEATURE]) clientProperties.features.push('QUICK_REPLIES')
          if (this.caps[Capabilities.LIVEPERSON_MULTI_DIALOG_FEATURE]) clientProperties.features.push('MULTI_DIALOG')
          if (this.caps[Capabilities.LIVEPERSON_RICH_CONTENT_FEATURE]) clientProperties.features.push('RICH_CONTENT')
          const headers = {
            'content-type': 'application/json',
            authorization: await getAccessToken(clientId, clientSecret, accountId),
            'X-LP-ON-BEHALF': await getJwsToken(clientId, clientSecret, accountId),
            'Client-Properties': clientProperties
          }
          requestOptions.headers = Object.assign(requestOptions.headers || {}, headers)

          const body = {}
          body.dialogId = context.conversationId
          body.conversationId = context.conversationId
          body.event = {
            type: 'ContentEvent',
            contentType: 'text/plain'
          }
          if (msg.buttons && msg.buttons.length > 0 && (msg.buttons[0].text || msg.buttons[0].payload)) {
            if (!msg.buttons[0].payload) {
              body.event.message = msg.buttons[0].text
            } else {
              const payload = msg.buttons[0].payload
              let publishText
              if (payload.actions && payload.actions.length > 0) {
                for (const action of payload.actions) {
                  if (action.type === 'publishText') {
                    publishText = action.text
                  }
                }
              }
              if (publishText) {
                body.event.message = publishText
              } else {
                throw new Error('Not supported yet')
              }
            }
          } else if (msg.media && msg.media.length > 0) {
            throw new Error('Not supported yet')
          } else {
            body.event.message = msg.messageText
          }
          requestOptions.body.body = body
        },
        [CoreCapabilities.SIMPLEREST_RESPONSE_HOOK]: ({ botMsg }) => {
          const mapButtonPayload = (p) => {
            let payload
            try {
              payload = JSON.parse(p)
            } catch (err) {
              payload = p
            }
            return payload
          }
          const mapButton = (b) => ({
            text: _.isString(b) ? b : b.title || b.text || b.label,
            payload: !_.isString(b) ? mapButtonPayload(b.click) : null
          })

          const event = _.get(botMsg.sourceData, 'body.changes[0].event')
          const metadata = _.get(botMsg.sourceData, 'body.changes[0].originatorMetadata')

          if (metadata && metadata.role === 'ASSIGNED_AGENT' &&
            event && (event.type === 'ContentEvent' || event.type === 'RichContentEvent')) {
            debug(`Response Body: ${util.inspect(botMsg.sourceData, false, null, true)}`)
            botMsg.buttons = botMsg.buttons || []
            botMsg.media = botMsg.media || []
            botMsg.cards = botMsg.cards || []

            if (event.type === 'ContentEvent') {
              if (event.contentType === 'text/plain') {
                botMsg.messageText = event.message
              }
              if (event.quickReplies && event.quickReplies.type === 'quickReplies') {
                for (const quickReply of event.quickReplies.replies) {
                  botMsg.buttons.push(mapButton(quickReply))
                }
              }
            } else if (event.type === 'RichContentEvent') {
              for (const element of event.content.elements) {
                if (element.type === 'text') {
                  botMsg.messageText = element.text
                }
                if (element.type === 'button') {
                  botMsg.buttons.push(mapButton(element))
                }
              }
            }
          }
        },
        [CoreCapabilities.SIMPLEREST_INBOUND_SELECTOR_JSONPATH]: '$.body.body.changes[0].conversationId',
        [CoreCapabilities.SIMPLEREST_INBOUND_SELECTOR_VALUE]: '{{context.conversationId}}',
        [CoreCapabilities.SIMPLEREST_STOP_HOOK]: async ({ context }) => {
          const params = {
            clientId: this.caps[Capabilities.LIVEPERSON_CLIENT_ID],
            clientSecret: this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET],
            accountId: this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID],
            conversationId: context.conversationId
          }
          await closeConversation(params)
        }
      }
      for (const capKey of Object.keys(this.caps).filter(c => c.startsWith('SIMPLEREST'))) {
        if (!this.delegateCaps[capKey]) this.delegateCaps[capKey] = this.caps[capKey]
      }

      debug(`Validate delegateCaps ${util.inspect(this.delegateCaps)}`)
      this.delegateContainer = new SimpleRestContainer({ queueBotSays: this.queueBotSays, caps: this.delegateCaps })
    }

    debug('Validate delegate')
    return this.delegateContainer.Validate()
  }

  async Build () {
    await this.delegateContainer.Build()
  }

  async Start () {
    await this.delegateContainer.Start()
  }

  async UserSays (msg) {
    await this.delegateContainer.UserSays(msg)
  }

  async Stop () {
    await this.delegateContainer.Stop()
  }

  async Clean () {
    await this.delegateContainer.Clean()
  }
}

module.exports = BotiumConnectorLivePerson
