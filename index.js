import BotiumConnectorLivePerson from './src/connector.js'
import AsserterSkillClass from './src/asserterskill.js'

export default {
  PluginVersion: 1,
  PluginClass: BotiumConnectorLivePerson,
  PluginAsserters: {
    CHECKLIVEPERSONSKILL: AsserterSkillClass
  }

}
