// const debug = require('debug')('botium-connector-liveperson-asserter-skill')
const _ = require('lodash')

class BotiumAsserterLivepersonSkill {
  constructor (context, caps = {}, args = {}) {
    this.context = context
    this.caps = caps
    this.globalArgs = args
  }

  assertConvoStep ({ container, args }) {
    const pluginInstance = container.pluginInstance
    if (!pluginInstance) throw new Error('Liveperson Connector not available')
    const currentSkillId = pluginInstance.currentSkillId
    if (_.isNil(currentSkillId)) throw new Error('Skill ID of the current conversation is unknown.')

    if (args.length > 1) {
      return Promise.reject(new Error(`Liveperson skill asserter is not well configured. Too much arguments "${args}"`))
    }

    if (args.length === 1) {
      if (currentSkillId !== args[0]) {
        return Promise.reject(new Error(`Skill "${currentSkillId}" is invalid. Expected "${args[0]}"`))
      }
    } else {
      if (currentSkillId === '-1') {
        return Promise.reject(new Error('Skill not available (Skill ID is "-1")'))
      }
    }

    return Promise.resolve()
  }
}

module.exports = BotiumAsserterLivepersonSkill
