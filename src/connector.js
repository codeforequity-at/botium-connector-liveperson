const util = require('util')
const _ = require('lodash')
const randomize = require('randomatic')
const mime = require('mime-types')
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
  LIVEPERSON_CAMPAIGN_ID: 'LIVEPERSON_CAMPAIGN_ID',
  LIVEPERSON_ENGAGEMENT_ID: 'LIVEPERSON_ENGAGEMENT_ID',
  LIVEPERSON_AUTO_MESSAGES_FEATURE: 'LIVEPERSON_AUTO_MESSAGES_FEATURE',
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
      const messagingDomain = await getDomainByServiceName(ASYNC_MESSAGING_SERVICE_NAME, this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID])
      if (!messagingDomain) throw new Error(`Can't find domain for '${ASYNC_MESSAGING_SERVICE_NAME}' service`)

      this.delegateCaps = {
        [CoreCapabilities.SIMPLEREST_URL]: `https://${messagingDomain}/api/account/${this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID]}/messaging/consumer/conversation/send?v=3`,
        [CoreCapabilities.SIMPLEREST_METHOD]: 'POST',
        [CoreCapabilities.SIMPLEREST_START_HOOK]: async ({ context }) => {
          context.livepersonSessionId = randomize('0', 10)
          const params = {
            clientId: this.caps[Capabilities.LIVEPERSON_CLIENT_ID],
            clientSecret: this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET],
            accountId: this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID],
            campaignId: this.caps[Capabilities.LIVEPERSON_CAMPAIGN_ID],
            engagementId: this.caps[Capabilities.LIVEPERSON_ENGAGEMENT_ID],
            autoMessages: this.caps[Capabilities.LIVEPERSON_AUTO_MESSAGES_FEATURE],
            userProfile: this.caps[Capabilities.LIVEPERSON_USER_PROFILE],
            livepersonSessionId: context.livepersonSessionId
          }
          const conversationId = await openConversation(params)
          if (!conversationId) throw new Error('Can not open conversation')
          context.conversationId = conversationId
        },
        [CoreCapabilities.SIMPLEREST_REQUEST_HOOK]: async ({ requestOptions, msg, context }) => {
          const clientId = this.caps[Capabilities.LIVEPERSON_CLIENT_ID]
          const clientSecret = this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET]
          const accountId = this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID]
          const clientProperties = {
            type: 'ClientProperties',
            features: []
          }
          if (this.caps[Capabilities.LIVEPERSON_AUTO_MESSAGES_FEATURE]) clientProperties.features.push('AUTO_MESSAGES')
          const headers = {
            'content-type': 'application/json',
            authorization: await getAccessToken(clientId, clientSecret, accountId),
            'X-LP-ON-BEHALF': await getJwsToken(clientId, clientSecret, accountId),
            'Client-Properties': clientProperties
          }
          requestOptions.headers = Object.assign(requestOptions.headers || {}, headers)

          const body = {}
          body.dialogId = context.conversationId
          body.event = {
            type: 'ContentEvent',
            contentType: 'text/plain'
          }
          if (msg.buttons && msg.buttons.length > 0 && (msg.buttons[0].text || msg.buttons[0].payload)) {
            if (!msg.buttons[0].payload) {
              body.event.message = msg.buttons[0].text
            } else {
              let payload
              try {
                payload = JSON.parse(msg.buttons[0].payload)
              } catch (e) {
                payload = msg.buttons[0].payload
              }
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
                body.event.message = payload
              }
            }
          } else if (msg.media && msg.media.length > 0) {
            throw new Error('Not supported yet')
          } else {
            body.event.message = msg.messageText
          }

          requestOptions.json = true
          requestOptions.body = {
            kind: 'req',
            id: randomize('0', 10),
            type: 'ms.PublishEvent',
            body
          }
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
          const mapMedia = (m) => ({
            mediaUri: _.isString(m) ? m : m.url,
            mimeType: (_.isString(m) ? mime.lookup(m) : mime.lookup(m.url)) || 'application/unknown'
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
              if (event.content.type === 'image') {
                botMsg.media.push(mapMedia(event.content))
              } else if (event.content.tag === 'button') {
                for (const element of event.content.elements) {
                  if (element.type === 'text') {
                    botMsg.messageText = element.text
                  }
                  if (element.type === 'button') {
                    botMsg.buttons.push(mapButton(element))
                  }
                }
              } else if (event.content.tag === 'generic') {
                const elements = event.content.elements
                const indexes = elements.reduce((a, e, i) => {
                  if (e.tag === 'title') { a.push(i) }
                  return a
                }, [])
                for (const i of indexes) {
                  const card = {
                    text: elements[i].text
                  }
                  if (elements[i - 1] && elements[i - 1].type === 'image') {
                    card.media = [mapMedia(elements[i - 1])]
                  }

                  if (elements[i + 1] && elements[i + 1].tag === 'subtitle') {
                    card.content = elements[i + 1].text
                    if (elements[i + 2] && elements[i + 2].tag === 'button') {
                      card.buttons = []
                      for (const e of elements[i + 2].elements) {
                        if (e.type === 'button') {
                          card.buttons.push(mapButton(e))
                        }
                      }
                    }
                  } else if (elements[i + 1] && elements[i + 1].tag === 'button') {
                    card.buttons = []
                    for (const e of elements[i + 1].elements) {
                      if (e.type === 'button') {
                        card.buttons.push(mapButton(e))
                      }
                    }
                  }
                  botMsg.cards.push(card)
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
