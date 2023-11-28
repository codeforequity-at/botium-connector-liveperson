const request = require('request-promise-native')
const _ = require('lodash')
const randomize = require('randomatic')
const debug = require('debug')('botium-connector-liveperson')

const JWT_TOKEN_SERVICE_NAME = 'sentinel'
const JWS_TOKEN_SERVICE_NAME = 'idp'
const ASYNC_MESSAGING_SERVICE_NAME = 'asyncMessagingEnt'
const DEFAULT_USER_PROFILE = {}

class Helper {
  constructor () {
    this.baseURIs = []
    this.accessToken = null
    this.jwsToken = null
    this.defaultClientProperties = {
      type: 'ClientProperties',
      features: []
    }
  }

  async getDomainByServiceName (serviceName, accountId) {
    if (this.baseURIs.length === 0) {
      const requestOptions = {
        url: `https://api.liveperson.net/api/account/${accountId}/service/baseURI?version=1.0`,
        method: 'GET',
        headers: {
          'content-type': 'application/json'
        },
        timeout: 30000,
        json: true
      }
      const result = await request(requestOptions)
      this.baseURIs.push(...result.baseURIs)
    }
    const baseURIObject = _.find(this.baseURIs, u => u.service === serviceName)
    return baseURIObject ? baseURIObject.baseURI : undefined
  }

  async _renewAccessToken (clientId, clientSecret, accountId) {
    const jwtDomain = await this.getDomainByServiceName(JWT_TOKEN_SERVICE_NAME, accountId)
    const requestOptions = {
      url: `https://${jwtDomain}/sentinel/api/account/${accountId}/app/token?v=1.0&grant_type=client_credentials`,
      method: 'POST',
      timeout: 30000,
      form: {
        client_id: clientId,
        client_secret: clientSecret
      },
      json: true
    }
    debug(`Request access token with the following requestOptions: ${JSON.stringify(requestOptions, null, 2)}`)
    const result = await request(requestOptions)
    this.accessToken = result.access_token
  }

  async getAccessToken (clientId, clientSecret, accountId) {
    if (this.accessToken) {
      const payload = JSON.parse(Buffer.from(this.accessToken.split('.')[1], 'base64').toString('utf-8'))
      const now = parseInt(Date.now() / 1000) + 60
      if (payload.exp < now) {
        await this._renewAccessToken(clientId, clientSecret, accountId)
      }
    }

    if (!this.accessToken) {
      await this._renewAccessToken(clientId, clientSecret, accountId)
    }

    return this.accessToken
  }

  async getJwsToken (clientId, clientSecret, accountId, extConsumerId) {
    if (!this.jwsToken) {
      const jwsDomain = await this.getDomainByServiceName(JWS_TOKEN_SERVICE_NAME, accountId)
      const requestOptions = {
        url: `https://${jwsDomain}/api/account/${accountId}/consumer`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: await this.getAccessToken(clientId, clientSecret, accountId)
        },
        body: {
          ext_consumer_id: extConsumerId
        },
        json: true,
        timeout: 30000
      }
      debug(`Request consumerJWS with the following requestOptions: ${JSON.stringify(requestOptions, null, 2)}`)
      const result = await request(requestOptions)
      this.jwsToken = result.token
    }

    return this.jwsToken
  }

  async openConversation ({ clientId, clientSecret, accountId, extConsumerId, campaignId, engagementId, clientPropertiesCap, userProfile, livepersonSessionId }) {
    const clientProperties = Object.assign(this.defaultClientProperties, clientPropertiesCap || {})

    const userProfileRequestObject = {
      kind: 'req',
      id: randomize('0', 8),
      type: 'userprofile.SetUserProfile',
      body: Object.assign(DEFAULT_USER_PROFILE, userProfile)
    }
    const consumerReqId = randomize('0', 8)
    const consumerConversationReqObject = {
      kind: 'req',
      id: consumerReqId,
      type: 'cm.ConsumerRequestConversation',
      body: {
        brandId: accountId,
        conversationContext: {
          sessionId: livepersonSessionId,
          interactionContextId: '2',
          type: 'SharkContext',
          lang: 'en-US'
        }
      }
    }

    if (campaignId && engagementId) {
      consumerConversationReqObject.body.campaignInfo = {
        campaignId,
        engagementId
      }
    }

    const messagingDomain = await this.getDomainByServiceName(ASYNC_MESSAGING_SERVICE_NAME, accountId)
    const requestOptions = {
      url: `https://${messagingDomain}/api/account/${accountId}/messaging/consumer/conversation?v=3`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: await this.getAccessToken(clientId, clientSecret, accountId),
        'X-LP-ON-BEHALF': await this.getJwsToken(clientId, clientSecret, accountId, extConsumerId),
        'Client-Properties': clientProperties
      },
      body: [userProfileRequestObject, consumerConversationReqObject],
      json: true,
      timeout: 30000
    }
    debug(`Open conversation with the following requestOptions: ${JSON.stringify(requestOptions, null, 2)}`)
    const result = await request(requestOptions)
    const conversation = _.find(result, r => r.reqId === consumerReqId)
    return conversation ? conversation.body.conversationId : undefined
  }

  async closeConversation ({ clientId, clientSecret, accountId, extConsumerId, conversationId }) {
    const closeConversationRequestObject = {
      kind: 'req',
      id: randomize('0', 8),
      type: 'cm.UpdateConversationField',
      body: {
        conversationId,
        conversationField: {
          field: 'ConversationStateField',
          conversationState: 'CLOSE'
        }
      }
    }

    const messagingDomain = await this.getDomainByServiceName(ASYNC_MESSAGING_SERVICE_NAME, accountId)
    const requestOptions = {
      url: `https://${messagingDomain}/api/account/${accountId}/messaging/consumer/conversation/send?v=3`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: await this.getAccessToken(clientId, clientSecret, accountId),
        'X-LP-ON-BEHALF': await this.getJwsToken(clientId, clientSecret, accountId, extConsumerId)
      },
      body: closeConversationRequestObject,
      json: true,
      timeout: 30000
    }
    debug(`Close conversation with the following requestOptions: ${JSON.stringify(requestOptions, null, 2)}`)
    await request(requestOptions)
  }
}

module.exports = Helper
