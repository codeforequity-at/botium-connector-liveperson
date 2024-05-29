const util = require('util')
const _ = require('lodash')
const randomize = require('randomatic')
const mime = require('mime-types')
const debug = require('debug')('botium-connector-liveperson')
const Helper = require('./helper')

const SimpleRestContainer = require('botium-core/src/containers/plugins/SimpleRestContainer')
const { Capabilities: CoreCapabilities } = require('botium-core')

const ASYNC_MESSAGING_SERVICE_NAME = 'asyncMessagingEnt'

const Capabilities = {
  LIVEPERSON_CLIENT_ID: 'LIVEPERSON_CLIENT_ID',
  LIVEPERSON_CLIENT_SECRET: 'LIVEPERSON_CLIENT_SECRET',
  LIVEPERSON_ACCOUNT_ID: 'LIVEPERSON_ACCOUNT_ID',
  LIVEPERSON_CAMPAIGN_ID: 'LIVEPERSON_CAMPAIGN_ID',
  LIVEPERSON_ENGAGEMENT_ID: 'LIVEPERSON_ENGAGEMENT_ID',
  LIVEPERSON_CLIENT_PROPERTIES: 'LIVEPERSON_CLIENT_PROPERTIES',
  LIVEPERSON_USER_PROFILE: 'LIVEPERSON_USER_PROFILE',
  LIVEPERSON_EXT_CONSUMER_ID: 'LIVEPERSON_EXT_CONSUMER_ID'
}

class BotiumConnectorLivePerson {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
    this.delegateContainer = null
    this.delegateCaps = null
    this.conversationId = null
    this.currentSkillId = null
    this.helper = new Helper()
  }

  async Validate () {
    debug('Validate called')

    this.caps = Object.assign({}, this.caps)

    if (!this.caps[Capabilities.LIVEPERSON_CLIENT_ID]) throw new Error('LIVEPERSON_CLIENT_ID capability required')
    if (!this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET]) throw new Error('LIVEPERSON_CLIENT_SECRET capability required')
    if (!this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID]) throw new Error('LIVEPERSON_ACCOUNT_ID capability required')
    if (_.isEmpty(this.caps[Capabilities.LIVEPERSON_EXT_CONSUMER_ID])) {
      this.caps[Capabilities.LIVEPERSON_EXT_CONSUMER_ID] = randomize('0', 10)
    }

    if (!this.delegateContainer) {
      const messagingDomain = await this.helper.getDomainByServiceName(ASYNC_MESSAGING_SERVICE_NAME, this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID])
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
            extConsumerId: this.caps[Capabilities.LIVEPERSON_EXT_CONSUMER_ID],
            campaignId: this.caps[Capabilities.LIVEPERSON_CAMPAIGN_ID],
            engagementId: this.caps[Capabilities.LIVEPERSON_ENGAGEMENT_ID],
            clientPropertiesCap: this.caps[Capabilities.LIVEPERSON_CLIENT_PROPERTIES],
            userProfile: this.caps[Capabilities.LIVEPERSON_USER_PROFILE],
            livepersonSessionId: context.livepersonSessionId
          }
          const conversationId = await this.helper.openConversation(params)
          if (!conversationId) throw new Error('Can not open conversation')
          context.conversationId = conversationId
        },
        [CoreCapabilities.SIMPLEREST_REQUEST_HOOK]: async ({ requestOptions, msg, context }) => {
          const clientId = this.caps[Capabilities.LIVEPERSON_CLIENT_ID]
          const clientSecret = this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET]
          const accountId = this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID]
          const extConsumerId = this.caps[Capabilities.LIVEPERSON_EXT_CONSUMER_ID]
          const clientPropertiesCap = this.caps[Capabilities.LIVEPERSON_CLIENT_PROPERTIES]
          const clientProperties = Object.assign(this.helper.defaultClientProperties, clientPropertiesCap || {})
          const headers = {
            'content-type': 'application/json',
            authorization: await this.helper.getAccessToken(clientId, clientSecret, accountId),
            'X-LP-ON-BEHALF': await this.helper.getJwsToken(clientId, clientSecret, accountId, extConsumerId),
            'Client-Properties': JSON.stringify(clientProperties)
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
          const type = _.get(botMsg.sourceData, 'type')

          if (type === 'cqm.ExConversationChangeNotification') {
            const currentSkillId = _.get(botMsg.sourceData, 'body.changes[0].result.conversationDetails.skillId')
            // As i see if there is no skill, then the skill id is -1.
            // So we always have a skill id
            if (!_.isNil(currentSkillId) && this.currentSkillId !== currentSkillId) {
              debug(`New skill: ${currentSkillId}`)
              this.currentSkillId = currentSkillId
            }

            return
          }

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

          const processElementRecursive = (element, rootCard) => {
            for (const subElement of element.elements) {
              if (subElement.type === 'text') {
                if (subElement.tag === 'title') {
                  rootCard.text = rootCard.text ? `${rootCard.text}\n${subElement.text}` : subElement.text
                } else if (subElement.tag === 'subtitle') {
                  rootCard.subtext = rootCard.subtext ? `${rootCard.subtext}\n${subElement.text}` : subElement.text
                } else {
                  rootCard.content = rootCard.content ? `${rootCard.content}\n${subElement.text}` : subElement.text
                }
              } else if (subElement.type === 'button') {
                rootCard.buttons.push(mapButton(subElement))
              } else if (subElement.type === 'image') {
                rootCard.media.push(mapMedia(subElement))
              } else if (subElement.type === 'vertical' || subElement.type === 'horizontal' || subElement.type === 'carousel') {
                rootCard = processElementRecursive(subElement, rootCard)
              }
            }
            return rootCard
          }

          if (metadata && metadata.role !== 'CONSUMER' &&
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
              if (event.content.tag && event.content.tag === 'card') {
                let card = {
                  buttons: [],
                  media: []
                }
                card = processElementRecursive(event.content, card)
                botMsg.cards.push(card)
              } else {
                for (const element of event.content.elements) {
                  if (element.type === 'text') {
                    botMsg.messageText = botMsg.messageText ? `${botMsg.messageText}\n${element.text}` : element.text
                  } else if (element.type === 'button') {
                    botMsg.buttons.push(mapButton(element))
                  } else if (element.type === 'image') {
                    botMsg.media.push(mapMedia(element))
                  } else if (element.type === 'vertical' || element.type === 'horizontal' || element.type === 'carousel') {
                    let card = {
                      buttons: [],
                      media: []
                    }
                    card = processElementRecursive(element, card)
                    botMsg.cards.push(card)
                  } else {
                    debug(`The following RichContent element is not supported yet: ${JSON.stringify(element, null, 2)}`)
                  }
                }
                if (event.quickReplies && event.quickReplies.type === 'quickReplies') {
                  for (const quickReply of event.quickReplies.replies) {
                    botMsg.buttons.push(mapButton(quickReply))
                  }
                }
              }
            }
          }
        },
        // $.body.body.changes[0].result.convId: to include cqm.ExConversationChangeNotification
        [CoreCapabilities.SIMPLEREST_INBOUND_SELECTOR_JSONPATH]: ['$.body.body.changes[0].conversationId', '$.body.body.changes[0].result.convId'],
        [CoreCapabilities.SIMPLEREST_INBOUND_SELECTOR_VALUE]: '{{context.conversationId}}',
        [CoreCapabilities.SIMPLEREST_STOP_HOOK]: async ({ context }) => {
          try {
            const params = {
              clientId: this.caps[Capabilities.LIVEPERSON_CLIENT_ID],
              clientSecret: this.caps[Capabilities.LIVEPERSON_CLIENT_SECRET],
              accountId: this.caps[Capabilities.LIVEPERSON_ACCOUNT_ID],
              extConsumerId: this.caps[Capabilities.LIVEPERSON_EXT_CONSUMER_ID],
              conversationId: context.conversationId
            }
            await this.helper.closeConversation(params)
          } finally {
            this.helper = new Helper()
          }
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
    this.currentSkillId = null
  }

  async Clean () {
    await this.delegateContainer.Clean()
  }
}

module.exports = BotiumConnectorLivePerson
