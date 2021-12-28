/**
Copyright 2020 ShenZhen Xiaoniu New Energy Inc. All Rights Reserved.
Author: saico@mosf.cn
**/

const { IoTClient,
        ListPolicyPrincipalsCommand,
        CreateKeysAndCertificateCommand,
        AttachPolicyCommand,
        AttachThingPrincipalCommand,
        CreatePolicyCommand,
        CreateThingCommand,
        DetachPolicyCommand,
        DetachThingPrincipalCommand,
        UpdateCertificateCommand,
        UpdateThingCommand,
        DeleteCertificateCommand } = require('@aws-sdk/client-iot');
const { IoTDataPlaneClient,PublishCommand } = require('@aws-sdk/client-iot-data-plane');
const config = require('./config');
const iotCONFIG = {region:config.AWS_REGION};
const iotclient = new IoTClient(iotCONFIG);
const iotdataclient = new IoTDataPlaneClient(iotCONFIG);
const moment = require('moment-timezone');

let listPolicyPrincipals = async ( mac ) => {
    let params = {
      policyName: mac
    };
    let iotdata;
    try {
      iotdata = await iotclient.send(new ListPolicyPrincipalsCommand(params));
    } catch (err) {
      iotdata = undefined;
    }
    return iotdata;
};

let createCert = async ( mac ) => {
    let createCertParams = {
      setAsActive: true
    };
    let certdata;
    try {
      certdata = await iotclient.send(new CreateKeysAndCertificateCommand(createCertParams));
    } catch (err) {
      certdata = undefined;
    }
    if (certdata) {
      let attachPolicyParams = {
        policyName: mac, 
        target: certdata.certificateArn 
     };
      let attachThingParams = {
        thingName: mac,
        principal: certdata.certificateArn
      };
      try {
        await iotclient.send(new AttachPolicyCommand(attachPolicyParams));
        await iotclient.send(new AttachThingPrincipalCommand(attachThingParams));
      } catch (err) {
        console.log(err);
      }
    }
    return certdata;
};
  
let issueCert = async ( mac ) => {
    let createPolicyParams = {
      policyName: mac,
      policyDocument: config.POLICY_DOCUMENT 
    };
    let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
    let createThingParams;
    createThingParams = {
      thingName: mac,
      attributePayload: {
        attributes: {
          'onltime':nowtm,
          'chargerid':'0',
          'connected':'0',
          'offtime':nowtm,
          'chargertype':config.DEFAULT_CHARGERTYPE,
          'gunstandard':config.DEFAULT_GUNSTANDARD,
          'guestok':config.DEFAULT_GUESTOK,
          'imax':'32,0,0',
          'ipaddress':'127.0.0.1'
        },
        merge: true
      },
      thingTypeName:config.DEFAULT_THINGTYPE
    };
    try {
      await iotclient.send(new CreatePolicyCommand(createPolicyParams));
      await iotclient.send(new CreateThingCommand(createThingParams));
    } catch (err) {
      console.log(err);
    }
    return await createCert(mac);
};
  
let reissueCert = async ( mac, certificateArn ) => {
    let detachPolicyParams = {
      policyName: mac,
      target: certificateArn
    };
    let detachThingParams = {
      thingName: mac,
      principal: certificateArn
    };
    try {
      await iotclient.send(new DetachPolicyCommand(detachPolicyParams));
      await iotclient.send(new DetachThingPrincipalCommand(detachThingParams));
      let certificateId = certificateArn.split('/')[1];
      let updateCertParams = {
        certificateId: certificateId,
        newStatus: 'INACTIVE'
      };
      await iotclient.send(new UpdateCertificateCommand(updateCertParams));
      let deleteCertParams = {
        certificateId: certificateId,
        forceDelete: false
      };
      await iotclient.send(new DeleteCertificateCommand(deleteCertParams));
    } catch (err) {
      console.log(err);
    }
    return await createCert(mac);
};

exports.mainHandler = async (payload) => {

    console.info(JSON.stringify(payload));

    console.time('xnapp');

    if (payload.connevent) {
        let mac = payload.connevent;
        let eventType = payload.eventType;
        if (eventType=='connected') {   //connect/disconnect基本上是同时调用，前后相差不超过100ms
            if (mac.length==12 && mac!='xniotevesps2') {
              let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
              let updatethingParams = {
                thingName: mac,
                attributePayload: {
                  attributes: {
                    'ipaddress': payload.ipAddress,
                    'onltime': nowtm,
                    'connected': '1'
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
        } else if (eventType=='disconnected') {
            if (mac.length==12 && mac!='xniotevesps2') {
              let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
              let updatethingParams = {
                thingName: mac,
                attributePayload: {
                  attributes: {
                    'offtime': nowtm,
                    'connected': '0'
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
        } else {
            console.error('connectevent', JSON.stringify(payload));
        }
    }
    if (payload.reportmac) {
        let mac = payload.reportmac;
        if (payload._dvtm) {
        }
        if (payload.guc) {
        }
        if (payload.getcert) {
            if (mac=='xniotevesps2') {
                let wifimac = payload.wifimac;
                let data = await listPolicyPrincipals( wifimac );
                let certArn = false;
                if (data && data.principals && data.principals.length>0) {
                  certArn = data.principals[0];
                }
                let certData;
                if (certArn) {
                  certData = await reissueCert(wifimac,certArn);
                } else {
                  certData = await issueCert(wifimac);
                }
                let certpem = certData.certificatePem.replace(/\n/g,'').replace(/-----.*?-----/g,'');
                let privkey = certData.keyPair.PrivateKey.replace(/\n/g,'').replace(/-----.*?-----/g,'');
                console.log(certpem);
                let getcertpayload = {'devcert':certpem};
                let pubparam = {
                    topic: 'xniot/work/'+mac,
                    payload: Buffer.from(JSON.stringify(getcertpayload)),
                    qos: 1
                };
                try {
                  await iotdataclient.send(new PublishCommand(pubparam));
                } catch (err) {
                  console.log(err);
                }
                console.log(privkey);
                getcertpayload = {'prvkey':privkey};
                pubparam = {
                    topic: 'xniot/work/'+mac,
                    payload: Buffer.from(JSON.stringify(getcertpayload)),
                    qos: 1
                };
                try {
                  await iotdataclient.send(new PublishCommand(pubparam));
                } catch (err) {
                  console.log(err);
                }
            }
        }
    }

    console.timeEnd('xnapp');

};