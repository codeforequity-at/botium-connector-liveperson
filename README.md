# Botium Connector for Live Person

[![NPM](https://nodei.co/npm/botium-connector-liveperson.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/botium-connector-liveperson/)

[![Codeship Status for codeforequity-at/botium-connector-liveperson](https://app.codeship.com/projects/ac5ab3a0-d0f5-0138-cac3-16239a5027f5/status?branch=master)](https://app.codeship.com/projects/408148)
[![npm version](https://badge.fury.io/js/botium-connector-liveperson.svg)](https://badge.fury.io/js/botium-connector-liveperson)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)]()


This is a [Botium](https://github.com/codeforequity-at/botium-core) connector for testing your [Live Person chatbot](https://www.liveperson.com/).

__Did you read the [Botium in a Nutshell](https://medium.com/@floriantreml/botium-in-a-nutshell-part-1-overview-f8d0ceaf8fb4) articles? Be warned, without prior knowledge of Botium you won't be able to properly use this library!__

## How it works
Botium connects to the API of your Live person chatbot.

It can be used as any other Botium connector with all Botium Stack components:
* [Botium CLI](https://github.com/codeforequity-at/botium-cli/)
* [Botium Bindings](https://github.com/codeforequity-at/botium-bindings/)
* [Botium Box](https://www.botium.at)

## Requirements
* **Node.js and NPM**
* a **Live Person bot**
* a **project directory** on your workstation to hold test cases and Botium configuration

## Install Botium and Live Person Connector

When using __Botium CLI__:

```
> npm install -g botium-cli
> npm install -g botium-connector-liveperson
> botium-cli init
> botium-cli run
```

When using __Botium Bindings__:

```
> npm install -g botium-bindings
> npm install -g botium-connector-liveperson
> botium-bindings init mocha
> npm install && npm run mocha
```

When using __Botium Box__:

_Already integrated into Botium Box, no setup required_

## Connecting Live Person chatbot to Botium

First of all you have to login and install a new application on Live Person [Connector App Hub](https://connector-api.dev.liveperson.net/). 
During the installation please set up the webhook endpoint field according to your server endpoint (from localhost you can use [ngrok](https://ngrok.com/), see later)

After the installation you will see a new row in the application installations list. 
Create a `botium.json` file and copy the following values in:
You have to copy the id value from the `Application Name & id` column into the `LIVEPERSON_CLIENT_ID`.
You have to copy the `secret` column value into the 

```
{
  "botium": {
    "Capabilities": {
      "PROJECTNAME": "<whatever>",
      "CONTAINERMODE": "liveperson",
      "LIVEPERSON_CLIENT_ID": "018908a5-aa8f-4f2a-bae4-1efe1f092e27",
      "LIVEPERSON_CLIENT_SECRET": "s8r6ttaar0m5ev2qaqhkbs9m5",
      "LIVEPERSON_ACCOUNT_ID": "72165163"
      "LIVEPERSON_AUTO_MESSAGES_FEATURE": true,
      "LIVEPERSON_QUICK_REPLIES_FEATURE": true,
      "LIVEPERSON_RICH_CONTENT_FEATURE": true
    }
  }
}
```

To check the configuration, run the emulator (Botium CLI required) to bring up a chat interface in your terminal window:

```
> botium-cli emulator
```

Botium setup is ready, you can begin to write your [BotiumScript](https://botium.atlassian.net/wiki/spaces/BOTIUM/pages/491664/Botium+Scripting+-+BotiumScript) files.

## How to start samples

There is a small demo in [samples](./samples) with Botium Bindings. 
By changing the corresponding capabilities you can use it with the default Live Person chatbot.

### Live Person chatbot sample

* Install the dependencies and botium-core as peerDependency:
    ```
    > npm install && npm install --no-save botium-core
    ```
* Navigate into the _samples/real_ directory
    * Install the dependencies
        ```
        > cd ./samples/real
        > npm install
        ```
    * Adapt botium.json in the sample directory:
        * Change `LIVEPERSON_CLIENT_ID` with your installed application id
        * Change `LIVEPERSON_CLIENT_SECRET` with your installed application secret
        * Change `LIVEPERSON_ACCOUNT_ID` with your accound id

    * Start `inbound-proxy` (it will listen on `http://127.0.0.1:45100/`):
         ```
         > npm run inbound
         ```
    * In your installed application you need to set `Webhook endpoint` according to the previous step set up inbound-proxy url.
      (To make this localhost url public you can use e.g. [ngrok](https://ngrok.com/))
    * Finally run the test
        ```
        >  npm test
        ```

## Supported Capabilities

Set the capability __CONTAINERMODE__ to __liveperson__ to activate this connector.

### LIVEPERSON_CLIENT_ID*
Live Person installed application id

### LIVEPERSON_CLIENT_SECRET*
Live Person installed application secret

### LIVEPERSON_ACCOUNT_ID*
Your account id

### LIVEPERSON_CAMPAIGN_ID
Filling `campaignId` and `engagementId` you can route your conversation to a specific bot.

### LIVEPERSON_ENGAGEMENT_ID
Filling `campaignId` and `engagementId` you can route your conversation to a specific bot.

### LIVEPERSON_AUTO_MESSAGES_FEATURE
To display chatbot welcome messages set it to true

### LIVEPERSON_QUICK_REPLIES_FEATURE
To turn on quick replies feature set it to true

### LIVEPERSON_RICH_CONTENT_FEATURE
To turn on rich content feature set it to true

### LIVEPERSON_USER_PROFILE
You can define a user profile object.
E.g.:
```
{
  "firstName": "Botium",
  "lastName": "",
  "role": "consumer",
  "description": ""
}
```
