const BotiumConnectorLivePerson = require('./src/connector')
const AsserterSkillClass = require('./src/asserterskill')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorLivePerson,
  PluginAsserters: {
    CHECKLIVEPERSONSKILL: AsserterSkillClass
  }

}
