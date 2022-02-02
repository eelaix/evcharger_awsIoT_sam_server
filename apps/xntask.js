/**
Copyright 2022 ShenZhen Xiaoniu New Energy Inc. All Rights Reserved.
Author: saico@mosf.cn
**/
const { IoTClient,
    DescribeThingCommand,
    UpdateThingCommand } = require('@aws-sdk/client-iot');
const config = require('./config');
const moment = require('moment-timezone');
const iotCONFIG = {region:config.AWS_REGION};
const iotclient = new IoTClient(iotCONFIG);

/***********************************************************************************************/

exports.mainHandler = async (event) => {
    let msgbody = event.Records[0].body;
    let bodyjson = JSON.parse(msgbody);
    let msgtype = bodyjson.msgtype;
    console.log(msgbody);
    console.time('xntask');
    if (msgtype==0) {
        let mac = bodyjson.mac;
        let prepotpassed= 10000;  //seconds
        let connected = 1;
        let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
        try {
          let iotdata = await iotclient.send(new DescribeThingCommand({thingName:mac}));
          let prepot = moment(iotdata.attributes.pot, config.SF).toDate().getTime();
          connected = Number(iotdata.attributes.connected);
          let nowseconds = new Date().getTime();
          prepotpassed = nowseconds - prepot;
          console.log('nowTM(tz):'+nowtm+',pot:'+iotdata.attributes.pot+',passed:'+prepotpassed);
        } catch (err) {
          console.error(err);
        }
        if ( prepotpassed > 60000 && connected > 0 ) {
          let updatethingParams = {
            thingName: mac,
            attributePayload: {
              attributes: {
                'offtime':nowtm,
                'onltime':'0'
              },
              merge: true
            }
          };
          try {
            await iotclient.send(new UpdateThingCommand(updatethingParams));
          } catch (err) {
            console.log(err);
          }
        }
    } else if (msgtype==1) {
    } else if (msgtype==2) {
    }
    console.timeEnd('xntask');
};