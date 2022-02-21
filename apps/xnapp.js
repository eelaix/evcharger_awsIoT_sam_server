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
        DescribeThingCommand,
        UpdateThingCommand,
        DeleteCertificateCommand } = require('@aws-sdk/client-iot');
const { IoTDataPlaneClient,PublishCommand } = require('@aws-sdk/client-iot-data-plane');
const config = require('./config');
const iotCONFIG = {region:config.AWS_REGION};
const iotclient = new IoTClient(iotCONFIG);
const iotdataclient = new IoTDataPlaneClient(iotCONFIG);
const moment = require('moment-timezone');

const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const sqsclient = new SQSClient(iotCONFIG);

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
          'gunstandard':config.DEFAULT_GUNSTANDARD,
          'guestok':config.DEFAULT_GUESTOK,
          'imax':'0,0',
          'hfconst':'64,64',
          'fmver':'1.0.0',
          'debug':'1',
          'pon':'1',
          'swk':'0',
          'gunstyle':'0',
          'pot':nowtm,
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

    // console.time('xnapp');

    if (payload.connevent) {
        let mac = payload.connevent;
        let eventType = payload.eventType;
        if (eventType=='connected') {   //connect/disconnect基本上是同时调用，前后相差不超过100ms
            if (mac.length==12) {
              let precnts = 0;
              let thingtypename = '';
              try {
                let iotdata = await iotclient.send(new DescribeThingCommand({thingName:mac}));
                precnts = Number(iotdata.attributes.connected);
                thingtypename = iotdata.thingTypeName;
                if ( isNaN(precnts) ) precnts = 0;
              } catch (err) {
                console.log(err);
              }
              if ( config.DEFAULT_THINGTYPE == thingtypename )
              {
                precnts++;
                let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
                let updatethingParams = {
                  thingName: mac,
                  attributePayload: {
                    attributes: {
                      'ipaddress':payload.ipAddress,
                      'onltime':nowtm,
                      'offtime':'0',
                      'connected':precnts.toString()
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
            }
        } else if (eventType=='disconnected') {
            if (mac.length==12 && mac!='xniotevesps2') {
              let msgbody = {
                msgtype: 0,
                mac:mac
              };
              let qeparams = {
                DelaySeconds: 30,
                MessageBody:JSON.stringify(msgbody),
                QueueUrl: config.SQS_QUEUE_URL
              };
              await sqsclient.send(new SendMessageCommand(qeparams));
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
        if (payload.olresp) { //服务器收到disconnect时，会延时30s向设备发送olreq，设备收到olreq立即回复olresp, 服务器在这里收到olresp立即修正在线状态
          let online = 0;
          try {
            let iotdata = await iotclient.send(new DescribeThingCommand({thingName:mac}));
            online = Number(iotdata.attributes.onltime);
          } catch (err) {
            console.error(err);
          }
          if (online==0) {
            let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
            let updatethingParams = {
              thingName: mac,
              attributePayload: {
                attributes: {
                  'onltime':nowtm,
                  'offtime':'0'
                },
                merge: true
              }
            }
            try {
              await iotclient.send(new UpdateThingCommand(updatethingParams));
            } catch (err) {
              console.log(err);
            } 
          }
        }
        if (payload.firstboot) {
          //{\"firstboot\":1,\"wifimac\":\"%.*s\",\"ver\":\"%1d.%1d.%1d\",\"dbg\":%1d,\"pon\":%10ld,swk:111,gun:1}
          let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
          let fmver = payload.ver;
          let debug = payload.dbg;
          let pon = payload.pon;
          let swk = payload.swk; //拨码开关状态111
          let updatethingParams = {
            thingName: mac,
            attributePayload: {
              attributes: {
                'pot':nowtm,
                'pon':pon.toString(),
                'fmver':fmver,
                'swk':swk.toString(),
                'debug':debug.toString(),
                'onltime':nowtm,
                'offtime':'0',
                'connected':'1'
              },
              merge: true
            }
          };
          try {
            await iotclient.send(new UpdateThingCommand(updatethingParams));
          } catch (err) {
            console.log(err);
          }
          let imax = [32,32];
          let hfconst = [64,64];
          let chargerid = '000000';
          try {
            let iotdata = await iotclient.send(new DescribeThingCommand({thingName:mac}));
            imax = iotdata.attributes.imax.split(',');
            hfconst = iotdata.attributes.hfconst.split(',');
            for (let i=0;i<imax.length;i++) {
              imax[i] = Number(imax[i]);
              hfconst[i] = Number(hfconst[i]);
            }
            chargerid = iotdata.attributes.chargerid;
          } catch (err) {
            console.error(err);
          }
          let outjson = {'firstboot':{'limit':imax,'chargerid':chargerid,'hfconst':hfconst/*,'pwmstyle':1*/}};
          let pubparam = {
            topic: 'xniot/work/'+mac,
            payload: Buffer.from(JSON.stringify(outjson)),
            qos: 1
          };
          try {
            await iotdataclient.send(new PublishCommand(pubparam));
          } catch (err) {
            console.log(err);
          }
        }
        if (payload.getcert) {
            if (mac=='xniotevesps2') {
                let wifimac = payload.wifimac;
                let gunstyle = payload.gun;
                let imax = '32,32';
                let hfconst = '64,64';
                if ( gunstyle == 1 ) {
                    imax = '0,32';
                    hfconst = '0,64';
                } else if ( gunstyle == 2 ) {
                    imax = '32,0';
                    hfconst = '64,0';
                }
                gunstyle = ''+gunstyle;
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
                let precertcnts = 0;
                try {
                  let iotdata = await iotclient.send(new DescribeThingCommand({thingName:'xniotevesps2'}));
                  precertcnts = Number(iotdata.attributes.certcnts);
                  if ( isNaN(precertcnts) ) precertcnts = 0;
                } catch (err) {
                  console.error(err);
                }
                precertcnts++;
                let nowtm = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
                let updatethingParams = {
                  thingName: 'xniotevesps2',//没有类型的物品，attributes不能超过三个
                  attributePayload: {
                    attributes: {
                      'lastmac': wifimac,
                      'certcnts': ''+precertcnts,
                      'certime': nowtm
                    }
                  }
                };
                try {
                  await iotclient.send(new UpdateThingCommand(updatethingParams));
                } catch (err) {
                  console.log(err);
                }
                updatethingParams = {
                  thingName: wifimac,
                  attributePayload: {
                    attributes: {
                      'imax': imax,
                      'hfconst': hfconst,
                      'gunstyle': gunstyle
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
        }
    }

    // console.timeEnd('xnapp');

};