/**
Copyright 2020 ShenZhen Xiaoniu New Energy Inc. All Rights Reserved.
Author: saico@mosf.cn
**/

const { IoTClient,ListThingsCommand,DescribeThingCommand,UpdateThingCommand } = require('@aws-sdk/client-iot');
const { IoTDataPlaneClient,GetThingShadowCommand,PublishCommand } = require('@aws-sdk/client-iot-data-plane');
const { DynamoDBClient,GetItemCommand,PutItemCommand,UpdateItemCommand,QueryCommand } = require('@aws-sdk/client-dynamodb');
const { nanoid } = require('nanoid');
const config = require('./config');
const uaparser = require('ua-parser-js');
const moment = require('moment-timezone');
const iotCONFIG = {region:config.AWS_REGION};
const iotclient = new IoTClient(iotCONFIG);
const iotdataclient = new IoTDataPlaneClient(iotCONFIG);
const ddbclient = new DynamoDBClient(iotCONFIG);

let response = { statusCode: 200, body: 'OK' };

exports.mainHandler = async (event, context, callback) => {
    console.log(event);
    let apiname = event.pathParameters.proxy || '';
    console.warn(apiname,'qry,'+JSON.stringify(event.queryStringParameters));
    try {
        if (apiname=='login') {
            let uid = event.queryStringParameters.userid;
            let usertype = 0;
            let userflag = '';
            let useritem = undefined;
            if (uid && uid.length==21) {
                let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
                let theuser = await ddbclient.send(new GetItemCommand(getparam));
                useritem = theuser.Item;
            }
            let ipaddress = event.requestContext.http.sourceIp;
            let useragent = event.requestContext.http.userAgent;
            let ua = uaparser(useragent);
            let uadevice = ua.device.model;
            if (!uadevice) {
              uadevice = ua.device.vendor;
            }
            if (!uadevice) {
              uadevice = ua.os.name;
            }
            let uabrowser = ua.browser.name;
            if (!uabrowser) {
              uabrowser = '(unknown)';
            }
            let last = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
            if (useritem) {
                if ( useritem.utype ) {
                  usertype = useritem.utype.N;
                }
                if ( useritem.uflag ) {
                  userflag = useritem.uflag.S;
                }
                let updateparam = { TableName: 'evuser', Key: {id:{S:uid}},
                  UpdateExpression: 'SET lastvisit=:last,uadevice=:uadev,uabrowser=:uabr,ipaddress=:ipadd',
                  ExpressionAttributeValues:{':last':{S:last},':uadev':{S:uadevice},':uabr':{S:uabrowser},':ipadd':{S:ipaddress}}
                };
                await ddbclient.send(new UpdateItemCommand(updateparam));
            } else {
                uid = await nanoid();  //21位包含_-
                // utype: 0 普通用户，1账单组管理者，由超级管理者升级，用户ID为账单组，账单组内设备由超级管理者分配 9超级管理者        ,permedthing:{SS:[]}
                let putparam = { TableName: 'evuser', Item: {
                      id:{S:uid},utype:{N:'0'},lastvisit:{S:last},regtime:{S:last},uadevice:{S:uadevice},uabrowser:{S:uabrowser},ipaddress:{S:ipaddress}
                    }
                };
                await ddbclient.send(new PutItemCommand(putparam));
            }
            response.body = JSON.stringify({id:uid,utype:usertype,uflag:userflag});
            callback(null, response);
        } else if (apiname=='listchargers') {
            let result = {nextToken:undefined,items:[]};
            let uid = event.queryStringParameters.userid;
            let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
            let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
            let usertype = 0;
            if (useritem && useritem.utype) usertype = useritem.utype.N;
            if ( usertype == 9 ) {
              let iotdata = undefined;
              let search = event.queryStringParameters.search;
              if ( search && search.length == 12 ) {
                try {
                  let descdata = await iotclient.send(new DescribeThingCommand({thingName:search}));
                  iotdata = {things:[]};
                  iotdata.things.push(descdata);
                } catch (err) {
                  console.error(err);
                }
              } else {
                let nextToken = event.queryStringParameters.nextToken;
                let connected = Number(event.queryStringParameters.connected);
                let listParam = {maxResults:config.MAX_RESULTS};
                if (nextToken) {
                    listParam.nextToken = nextToken;
                }
                if (search && search.length > 3 && search.length < 11) {
                    if ( search.length < 6 ) {
                      listParam.attributeName = 'chargerid';
                      listParam.attributeValue = search;
                      listParam.usePrefixAttributeValue = true;
                    } else if ( search.length == 6 ) {
                      listParam.attributeName = 'chargerid';
                      listParam.attributeValue = search;
                    } else if ( search.length < 11 ) {
                      listParam.attributeName = 'onltime';
                      listParam.attributeValue = search.replace(/-/g,'');
                      listParam.usePrefixAttributeValue = true;
                    }
                }
                if (connected) {
                  listParam.attributeName = 'connected';
                  listParam.attributeValue = connected==1?'1':'0';
                }
                if ( !listParam.attributeName ) {
                  listParam.thingTypeName = config.DEFAULT_THINGTYPE;
                }
                try {
                    console.log(JSON.stringify(listParam));
                    iotdata = await iotclient.send(new ListThingsCommand(listParam));
                } catch (err) {
                    console.error(err);
                    iotdata = undefined;
                }
              }
              if (iotdata) {
                  if ( iotdata.nextToken ) {
                    result.nextToken = iotdata.nextToken;
                  }
                  let item,getParam,shadow,payload,shadowtsmeta,beep,beepkeyid;
                  for (let i=0;i<iotdata.things.length;i++) {
                    item = {};
                    item.chargerid = iotdata.things[i].attributes.chargerid;
                    item.mac = iotdata.things[i].thingName;
                    item.pot = iotdata.things[i].attributes.pot;
                    item.pon = iotdata.things[i].attributes.pon;
                    item.sipg = Number(iotdata.things[i].attributes.sipg);
                    item.pnp = Number(iotdata.things[i].attributes.pnp);
                    item.onltime = iotdata.things[i].attributes.onltime;
                    item.ver = iotdata.things[i].attributes.fmver;
                    item.offtime = iotdata.things[i].attributes.offtime;
                    item.connected = Number(iotdata.things[i].attributes.connected);
                    item.gunstandard = Number(iotdata.things[i].attributes.gunstandard);
                    item.chargertype = Number(iotdata.things[i].attributes.chargertype);
                    item.ipaddress = iotdata.things[i].attributes.ipaddress;
                    item.imax = iotdata.things[i].attributes.imax;
                    item.location = await config.getipcity(item.ipaddress);
                    item.guestok = Number(iotdata.things[i].attributes.guestok);
                    if (isNaN(item.connected)) item.connected = 0;
                    if (isNaN(item.gunstandard)) item.gunstandard = 0;
                    if (isNaN(item.chargertype)) item.chargertype = 0;
                    try {
                      getParam = {thingName:item.mac};
                      shadow = await iotdataclient.send(new GetThingShadowCommand(getParam));
                      payload = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(shadow.payload)));
                      shadowtsmeta = payload.metadata.reported;
                      beep = 0;
                      Object.keys(shadowtsmeta).forEach((key) => {
                        if (key.length==3 && shadowtsmeta[key].timestamp>beep) {
                          beep = shadowtsmeta[key].timestamp;
                          beepkeyid = config.shadowkeys[key];
                        }
                      });
                      item.beeptime = moment(beep*1000).tz(config.TZ).format(config.TF);
                      item.beepkeyid = beepkeyid;
                      item.rebootdate = item.pot.substr(0,4)+'-'+item.pot.substr(4,2)+'-'+item.pot.substr(6,2);
                      item.onlinedate = item.onltime.substr(0,4)+'-'+item.onltime.substr(4,2)+'-'+item.onltime.substr(6,2);
                      item.offdate = item.offtime.substr(0,4)+'-'+item.offtime.substr(4,2)+'-'+item.offtime.substr(6,2);
                      item.tp0 = payload.state.reported.tp0-100;
                      item.tp1 = payload.state.reported.tp1-100;
                      item.tp2 = payload.state.reported.tp2-100;
                      item.dor = payload.state.reported.dor;
                      item.stp = payload.state.reported.stp;
                      item.lgd = payload.state.reported.lgd;
                      item.sw0 = payload.state.reported.sw0;
                      item.sw1 = payload.state.reported.sw1;
                      item.sw2 = payload.state.reported.sw2;
                      item.pw0 = payload.state.reported.pw0;
                      item.pw1 = payload.state.reported.pw1;
                      item.pw2 = payload.state.reported.pw2;
                      item.ix0 = payload.state.reported.ix0;
                      item.ix1 = payload.state.reported.ix1;
                      item.ix2 = payload.state.reported.ix2;
                      item.cp0 = payload.state.reported.cp0;
                      item.cp1 = payload.state.reported.cp1;
                      item.cp2 = payload.state.reported.cp2;
                      item.cz0 = payload.state.reported.cz0;
                      item.cz1 = payload.state.reported.cz1;
                      item.cz2 = payload.state.reported.cz2;
                      item.st0 = payload.state.reported.st0;
                      item.st1 = payload.state.reported.st1;
                      item.st2 = payload.state.reported.st2;
                      if (item.chargertype==0) {
                        item.ecurrent = (payload.state.reported.ix0/1000).toFixed(1)+'x3';
                        item.pw0 = item.pw0+item.pw1+item.pw2;
                        item.pwa = item.pw0<10000?(item.pw0/1000).toFixed(3):(item.pw0<100000?(item.pw0/1000).toFixed(2):(item.pw0<1000000?(item.pw0/1000).toFixed(1):((item.pw0/1000).toFixed(0))));
                      } else if (item.chargertype==1) {
                        item.ecurrent = ((payload.state.reported.ix0+payload.state.reported.ix1+payload.state.reported.ix2)/1000).toFixed(1)+'A';
                        item.pwa = item.pw0<10000?(item.pw0/1000).toFixed(3):(item.pw0<100000?(item.pw0/1000).toFixed(2):(item.pw0<1000000?(item.pw0/1000).toFixed(1):((item.pw0/1000).toFixed(0))));
                      } else {
                        item.ecurrent = (payload.state.reported.ix0/1000).toFixed(0)+'/'+(payload.state.reported.ix1/1000).toFixed(1)+'/'+(payload.state.reported.ix2/1000).toFixed(0);
                        item.pwa = (item.pw0/1000).toFixed(0)+'/'+(item.pw1/1000).toFixed(3)+'/'+(item.pw2/1000).toFixed(3);
                      }
                      result.items.push(item);
                    } catch (err) {
                      console.error(err);
                      console.log('no shadow for thing ['+item.mac+'] exists!');
                    }
                  }
              }
            }
            response.body = JSON.stringify(result);
            callback(null, response);
        } else if (apiname=='getcharger') {
          let result = {mac:'',guestok:1,chargertype:0,gunstandard:0,connected:0,ver:'0.0.0',pnp:0,stp:0,dor:0,lgd:0,st0:0,st1:0,st2:0,pw0:0,pw1:0,pw2:0,pw3:0,ix0:0,ix1:0,ix2:0,tp0:0,tp1:0,cp0:0,cp1:0,cp2:0,cz0:0,cz1:0,cz2:0};
          let chargerid = event.queryStringParameters.chargerid;
          let gunid = Number(event.queryStringParameters.gunid)||0;
          let loads = event.queryStringParameters.loads;
          let mac = event.queryStringParameters.mac;
          if ( !mac ) {
            // 客户端没有提供mac，因为第一次扫码，不知道mac，一定会有chargerid,根据chargerid找到mac
            let listParam = {attributeName:'chargerid',attributeValue:chargerid};
            let iotdata = undefined;
            try {
              iotdata = await iotclient.send(new ListThingsCommand(listParam));
            } catch (err) {
              iotdata = undefined;
            }
            if ( iotdata && iotdata.things && iotdata.things.length>0 ) {
              mac = iotdata.things[0].thingName;
            }
          }
          if ( mac ) {
            let descparam = {thingName:mac};
            let iotdata;
            try {
              iotdata = await iotclient.send(new DescribeThingCommand(descparam));
            } catch (err) {
              iotdata = undefined;
            }
            result.mac = mac;
            let cpid = otdata.attributes.cpid;
            if (cpid==undefined) cpid = '0';/*三相单枪或单相单枪时,CP电路的编号,仅在服务器使用，不下发到设备，不影响设备*/
            result.guestok = Number(iotdata.attributes.guestok);
            result.chargertype = Number(iotdata.attributes.chargertype);
            result.gunstandard = Number(iotdata.attributes.gunstandard);
            result.connected = Number(iotdata.attributes.connected);
            result.ver = iotdata.attributes.fmver;
            result.pnp = Number(iotdata.attributes.pnp);
            let shadow = await iotdataclient.send(new GetThingShadowCommand(descparam));
            let payload = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(shadow.payload)));
            result.tp0 = payload.state.reported.tp0-100;
            result.tp1 = payload.state.reported.tp1-100;
            result.tp2 = payload.state.reported.tp2-100;
            result.stp = payload.state.reported.stp;
            result.dor = payload.state.reported.dor;
            result.lgd = payload.state.reported.lgd;
            if ( result.chargertype < 2 ) {  //0=三相电，1=单相单枪
              result.sta = payload.state.reported['st'+cpid];
              result.swa = payload.state.reported['sw'+cpid];
              result.ixa = payload.state.reported['ix'+cpid];
              result.ixa = result.ixa>10000?(result.ixa/1000).toFixed(0):(result.ixa/1000).toFixed(1);
              if ( result.chargertype == 0 ) result.ixa = result.ixa + 'x3';
              result.cpa = (payload.state.reported['cp'+cpid]/10).toFixed(1);
              result.cza = (payload.state.reported['cz'+cpid]/10).toFixed(1);
              result.pwa = payload.state.reported['pw'+cpid];
              if ( result.chargertype == 0 ) {
                result.pwa = payload.state.reported.pw0+payload.state.reported.pw1+payload.state.reported.pw2;
              }
            } else {
              result.sta = payload.state.reported['st'+gunid];
              result.swa = payload.state.reported['sw'+gunid];
              result.ixa = payload.state.reported['ix'+gunid];
              result.ixa = result.ixa>10000?(result.ixa/1000).toFixed(0):(result.ixa/1000).toFixed(1);
              result.cpa = (payload.state.reported['cp'+gunid]/10).toFixed(1);
              result.cza = (payload.state.reported['cz'+gunid]/10).toFixed(1);
              result.pwa = payload.state.reported['pw'+gunid];
            }
            if ( result.pwa < 10000 ) {
              result.pwa = (result.pwa/1000).toFixed(3);
            } else if ( result.pwa < 100000 ) {
              result.pwa = (result.pwa/1000).toFixed(2);
            } else if ( result.pwa < 1000000 ) {
              result.pwa = (result.pwa/1000).toFixed(1);
            } else {
              result.pwa = (result.pwa/1000).toFixed(0);
            }
            if ( result.connected ) {
              if ( result.stp ) {
                result.stateid = 5;
              } else if ( result.sta == 0 ) {
                if ( payload.state.reported['cp'+gunid] >50 && payload.state.reported['cp'+gunid] < 98 ) {
                  result.stateid = 1;  //readygunin
                } else {  //没有插枪，空闲 readyfree
                  if ( result.lgd == 1 ) {  //接地良好
                    result.stateid = 0;
                  } else {
                    result.stateid = 4;
                  }
                }
              } else if ( result.sta == 1 ) {
                result.stateid = 2;
              } else if ( result.sta == 6 ) {
                result.stateid = 3;
              }
            } else {
              result.stateid = 6;
            }
            result.imax = '32,0,0';//iotdata.attributes.imax.split(',');
            for (let i=0;i<result.imax.length;i++) {
              result.imax[i] = Number(result.imax[i]);
            }
            if ( loads == 0 ) {
              let pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'beep':2})),
                qos: 1
              };
              await iotdataclient.send(new PublishCommand(pubparam));
            } else if ( loads == 1) {
              let pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'reload':120})),
                qos: 1
              };
              await iotdataclient.send(new PublishCommand(pubparam));
            }
          }
          response.body = JSON.stringify(result);
          callback(null, response);
        } else if (apiname=='docharge') {
          let errcode = 0;
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let mac = event.queryStringParameters.mac;
          let gid = Number(event.queryStringParameters.gunid)||0;//枪编号
          let descparam = {thingName:mac};
          let iotdata,guestok;
          try {
            iotdata = await iotclient.send(new DescribeThingCommand(descparam));
          } catch (err) {
            errcode = 1;  //没有这个设备
            iotdata = undefined;
          }
          if ( iotdata ) {
            guestok = iotdata.attributes.guestok;
            if ( guestok == '0' ) {
              if ( useritem ) {
                if ( useritem.permedthing && useritem.permedthing.SS && !useritem.permedthing.SS.contains(mac) ) {
                  //设备设置为授权启动，但用户账号不在授权列表中
                  errcode = 3;
                }
              } else {
                //没有这个用户
                errcode = 2;
              }
            }
          }
          if ( errcode == 0 ) {
            //一切正常
            let swon = {'swon':1<<gid};
            let pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify(swon)),
                qos: 1
            };
            try {
              await iotdataclient.send(new PublishCommand(pubparam));
            } catch (err) {
              console.log(err);
            }
          }
          response.body = JSON.stringify({rc:errcode});
          callback(null, response);
        } else if (apiname=='setuserflag') {  //usernickname, or usermobile... or custom defined msg
          let uid = event.queryStringParameters.userid;
          let uflag = event.queryStringParameters.uflag;
          let last = moment(new Date().getTime()).tz(config.TZ).format(config.SF);
          let updateparam = { TableName: 'evuser', Key: {id:{S:uid}},
            UpdateExpression: 'SET lastvisit=:last,uflag=:flag',
            ExpressionAttributeValues:{':last':{S:last},':flag':{S:uflag}}
          };
          await ddbclient.send(new UpdateItemCommand(updateparam));
          response.body = JSON.stringify({rc:1});
          callback(null, response);
        } else if (apiname=='setgunstandard') {  //us,eu,gb
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype == 9 ) {
            let gunstandard = event.queryStringParameters.gunstandard;
            let mac = event.queryStringParameters.mac;
            let updatethingParams = {
              thingName: mac,
              attributePayload: {
                attributes: {
                  'gunstandard': gunstandard
                },
                merge: true
              }
            };
            try {
              await iotclient.send(new UpdateThingCommand(updatethingParams));
              ret.rc = 1;
            } catch (err) {
              ret.rc = -2;
              console.log(err);
            }
          } else {
            ret.rc = -1;
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='setchargertype') {  //0,1,2,3
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype == 9 ) {
            let chargertype = event.queryStringParameters.chargertype;
            let mac = event.queryStringParameters.mac;
            let updatethingParams = {
              thingName: mac,
              attributePayload: {
                attributes: {
                  'chargertype': chargertype
                },
                merge: true
              }
            };
            try {
              await iotclient.send(new UpdateThingCommand(updatethingParams));
              ret.rc = 1;
            } catch (err) {
              ret.rc = -2;
              console.log(err);
            }
          } else {
            ret.rc = -1;
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='setguestok') {  //0,1,2,3
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype == 9 ) {
            let guestok = event.queryStringParameters.guestok;
            let mac = event.queryStringParameters.mac;
            let updatethingParams = {
              thingName: mac,
              attributePayload: {
                attributes: {
                  'guestok': guestok
                },
                merge: true
              }
            };
            try {
              await iotclient.send(new UpdateThingCommand(updatethingParams));
              ret.rc = 1;
            } catch (err) {
              ret.rc = -2;
              console.log(err);
            }
          } else {
            ret.rc = -1;
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='setmyuserid') {  //将指定的用户ID写入客户端浏览器以实现用户账户恢复
          response.body = JSON.stringify({uerid:config.RESTORE_USERID});
          callback(null, response);
        } else if (apiname=='setchargerid') {
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype == 9 ) {
            let mac = event.queryStringParameters.mac;
            let chargerid = event.queryStringParameters.chargerid;
            let listParam = {attributeName:'chargerid',attributeValue:chargerid};
            let iotdata = undefined;
            try {
              iotdata = await iotclient.send(new ListThingsCommand(listParam));
            } catch (err) {
              iotdata = undefined;
            }
            let uid = event.queryStringParameters.userid;
            let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
            let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
            let usertype = 0;
            if (useritem) usertype = useritem.utype.N;
            if ( iotdata == undefined || iotdata.things.length==0 ) {
              if ( usertype == 9 ) {
                let updatethingParams = {
                  thingName: mac,
                  attributePayload: {
                    attributes: {
                      'chargerid': chargerid
                    },
                    merge: true
                  }
                };
                try {
                  await iotclient.send(new UpdateThingCommand(updatethingParams));
                  ret.rc = 1;
                } catch (err) {
                  ret.rc = -4;
                  console.log(err);
                }  
              } else {
                ret.rc = -3;
              }
            } else {
              ret.rc = -2;
              ret.rm = 'Error:IdExists';
            }
          } else {
            ret.rc = -1;
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='docmd') {
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype > 0 ) {
            let cmdid = Number(event.queryStringParameters.cmd)||1;
            let mac = event.queryStringParameters.mac;
            let pubparam;
            if (cmdid==1) {
              pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'cmd':'update'})),
                qos: 1
              };
            } else if (cmdid==2) {
              pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'cmd':'reboot'})),
                qos: 1
              };
            } else {
              pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'beep':3})),
                qos: 1
              };
            }
            try {
              await iotdataclient.send(new PublishCommand(pubparam));
            } catch (err) {
              ret.rc = -2;
              console.log(err);
            }
          } else {
            ret.rc = -1;
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='index.html') {
            let nowtmstr = moment(new Date().getTime()).tz(config.TZ).format(config.TF);
            response.headers['content-type'] = 'text/plain';
            response.body = 'iotappServer: ' + nowtmstr + ' @ ' + config.APIVERSION;
            return response;
        } else {
            console.warn(apiname, 'qry,'+JSON.stringify(event.queryStringParameters)+',env,'+JSON.stringify(process.env, null, 2));
            response.body = 'NOT FOUND';
            response.statusCode = 404;
            callback(null, response);
        }
    } catch (err) {
        console.error(err);
        console.error(event);
        response.body = 'FATAL ERROR';
        response.statusCode = 500;
        callback(null, response);
    }
};
