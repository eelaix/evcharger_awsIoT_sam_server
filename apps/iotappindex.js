/**
Copyright 2020 ShenZhen Xiaoniu New Energy Inc. All Rights Reserved.
Author: saico@mosf.cn
**/

const { IoTClient,ListThingsCommand,DescribeThingCommand,UpdateThingCommand,GetOTAUpdateCommand } = require('@aws-sdk/client-iot');
const { IoTDataPlaneClient,GetThingShadowCommand,PublishCommand } = require('@aws-sdk/client-iot-data-plane');
const { DynamoDBClient,GetItemCommand,PutItemCommand,UpdateItemCommand,QueryCommand,DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { nanoid } = require('nanoid');
const config = require('./config');
const uaparser = require('ua-parser-js');
const moment = require('moment-timezone');
const iotCONFIG = {region:config.AWS_REGION};
const iotclient = new IoTClient(iotCONFIG);
const iotdataclient = new IoTDataPlaneClient(iotCONFIG);
const ddbclient = new DynamoDBClient(iotCONFIG);

let response = { statusCode: 200, body: 'OK' , headers: {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Credentials':true}};

exports.mainHandler = async (event, context, callback) => {
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
            if ( uabrowser == 'WeChat' ) {
              usertype = -1;
            } else {
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
                        id:{S:uid},utype:{N:'0'},lastvisit:{S:last},regtime:{S:last},
                        uadevice:{S:uadevice},uabrowser:{S:uabrowser},ipaddress:{S:ipaddress},chgtimes:{N:'0'},powall:{N:'0'}
                      }
                  };
                  await ddbclient.send(new PutItemCommand(putparam));
              }
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
                  let item,getParam,shadow,payload,shadowtsmeta,beep,beepkeyid='non';
                  for (let i=0;i<iotdata.things.length;i++) {
                    if ( iotdata.things[i].thingTypeName != config.DEFAULT_THINGTYPE ) continue;
                    item = {};
                    item.chargerid = iotdata.things[i].attributes.chargerid;
                    item.mac = iotdata.things[i].thingName;
                    item.pot = iotdata.things[i].attributes.pot;
                    item.pon = iotdata.things[i].attributes.pon;
                    item.swk = Number(iotdata.things[i].attributes.swk);
                    item.onltime = iotdata.things[i].attributes.onltime;
                    item.ver = iotdata.things[i].attributes.fmver;
                    item.offtime = iotdata.things[i].attributes.offtime;
                    item.connected = Number(iotdata.things[i].attributes.connected);
                    item.gunstandard = Number(iotdata.things[i].attributes.gunstandard);
                    item.ipaddress = iotdata.things[i].attributes.ipaddress;
                    item.imax = iotdata.things[i].attributes.imax.split(',');
                    item.hfconst = iotdata.things[i].attributes.hfconst.split(',');
                    item.guestok = Number(iotdata.things[i].attributes.guestok);
                    item.gunstyle = Number(iotdata.things[i].attributes.gunstyle);
                    if (isNaN(item.connected)) item.connected = 0;
                    if (isNaN(item.gunstandard)) item.gunstandard = 0;
                    try {
                      getParam = {thingName:item.mac};
                      shadow = await iotdataclient.send(new GetThingShadowCommand(getParam));
                      payload = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(shadow.payload)));
                      shadowtsmeta = payload.metadata.reported;
                      beep = 0;
                      Object.keys(shadowtsmeta).forEach((key) => {
                        if (key.length==3 && shadowtsmeta[key].timestamp>beep && key!='pid' && key!='stp') {
                          beep = shadowtsmeta[key].timestamp;
                          beepkeyid = key;
                        }
                      });

                      item.beeptime = moment(beep*1000).tz(config.TZ).format(config.ST);
                      item.keyid = beepkeyid;
                      item.rebootdate = item.pot.substr(0,4)+'-'+item.pot.substr(4,2)+'-'+item.pot.substr(6,2);
                      item.onlinedate = item.onltime.substr(0,4)+'-'+item.onltime.substr(4,2)+'-'+item.onltime.substr(6,2);
                      item.offdate = item.offtime.substr(0,4)+'-'+item.offtime.substr(4,2)+'-'+item.offtime.substr(6,2);
                      item.dor = payload.state.reported.dor;
                      item.stp = payload.state.reported.stp;
                      item.lgd = payload.state.reported.lgd;
                      item.tpa = [payload.state.reported.tp0-100,payload.state.reported.tp1-100];
                      item.swa = [payload.state.reported.sw0,payload.state.reported.sw1];
                      item.pwa = [payload.state.reported.pw0,payload.state.reported.pw1];
                      item.ixa = [payload.state.reported.ix0,payload.state.reported.ix1];
                      item.cpa = [payload.state.reported.cp0,payload.state.reported.cp1];
                      item.cza = [payload.state.reported.cz0,payload.state.reported.cz1];
                      item.sta = [payload.state.reported.st0,payload.state.reported.st1];
                      item.pva = [payload.state.reported.pv0,payload.state.reported.pv1];
                      item.cpa[0] = (item.cpa[0]/10).toFixed(1);
                      item.cpa[1] = (item.cpa[1]/10).toFixed(1);
                      item.cza[0] = (item.cza[0]/10).toFixed(1);
                      item.cza[1] = (item.cza[1]/10).toFixed(1);
                      item.ixa[0] = (item.ixa[0]/1000).toFixed(1);
                      item.ixa[1] = (item.ixa[1]/1000).toFixed(1);
                      if ( item.pwa[0] < 10000 ) {
                          item.pwa[0] = (item.pwa[0]/1000).toFixed(3);
                      } else if ( item.pwa[0] < 100000 ) {
                          item.pwa[0] = (item.pwa[0]/1000).toFixed(2);
                      } else if ( item.pwa[0] < 1000000 ) {
                          item.pwa[0] = (item.pwa[0]/1000).toFixed(1);
                      } else {
                          item.pwa[0] = (item.pwa[0]/1000).toFixed(0);
                      }
                      if ( item.pwa[1] < 10000 ) {
                          item.pwa[1] = (item.pwa[1]/1000).toFixed(3);
                      } else if ( item.pwa[1] < 100000 ) {
                          item.pwa[1] = (item.pwa[1]/1000).toFixed(2);
                      } else if ( item.pwa[1] < 1000000 ) {
                          item.pwa[1] = (item.pwa[1]/1000).toFixed(1);
                      } else {
                          item.pwa[1] = (item.pwa[1]/1000).toFixed(0);
                      }
                      for (let i=0;i<2;i++) {
                        if (item.sta[i]==null || item.sta[i]=='null' || item.sta[i]=='NaN') item.sta[i] = 0;
                        if (item.swa[i]==null || item.swa[i]=='null' || item.swa[i]=='NaN') item.swa[i] = '-';
                        if (item.pwa[i]==null || item.pwa[i]=='null' || item.pwa[i]=='NaN') item.pwa[i] = '-';
                        if (item.ixa[i]==null || item.ixa[i]=='null' || item.ixa[i]=='NaN') item.ixa[i] = '-';
                        if (item.cpa[i]==null || item.cpa[i]=='null' || item.cpa[i]=='NaN') item.cpa[i] = '-';
                        if (item.cza[i]==null || item.cza[i]=='null' || item.cza[i]=='NaN') item.cza[i] = '-';
                        if (item.pva[i]==null || item.pva[i]=='null' || item.pva[i]=='NaN') item.pva[i] = '-';
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
          } else if (apiname=='listchargerids') {
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
                  for (let i=0;i<iotdata.things.length;i++) {
                    if ( iotdata.things[i].thingTypeName != config.DEFAULT_THINGTYPE ) continue;
                    result.items.push(iotdata.things[i].attributes.chargerid);
                  }
              }
            }
            response.body = JSON.stringify(result);
            callback(null, response);
        } else if (apiname=='listusers') {
            let result = {nextToken:undefined,items:[]};
            let uid = event.queryStringParameters.userid;
            let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
            let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
            let usertype = 0;
            if (useritem && useritem.utype) usertype = useritem.utype.N;
            if ( usertype == 9 ) {
              let search = event.queryStringParameters.search;
              let utype = event.queryStringParameters.utype||'0';
              let _id,_regtime,_lastvisit,_utype,_powall,_uadevice,_uabrowser,_ipaddress,_chgtimes,_uflag;
              let _permedchargers;
              if ( search ) {
                let key2 = {
                  'utype':{ComparisonOperator:'EQ',AttributeValueList:[{N:utype}]},
                  'uflag':{ComparisonOperator:'BEGINS_WITH',AttributeValueList:[{S:search}]}
                };
                let qryparam2 = {TableName:'evuser', KeyConditions:key2, IndexName: 'gsi_uflag' };
                let searchdata = await ddbclient.send(new QueryCommand(qryparam2));
                for (let i=0;i<searchdata.Items.length;i++) {
                  getparam.Key.id.S = searchdata.Items[i].id.S;
                  useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
                  if (useritem.uflag) {
                    _uflag = useritem.uflag.S;
                  } else {
                    _uflag = '-';
                  }
                  _permedchargers = [];
                  if (useritem.permedcharger && useritem.permedcharger.SS) {
                      _permedchargers = useritem.permedcharger.SS;
                  }
                  _id = useritem.id.S;
                  _regtime = useritem.regtime.S;
                  _uadevice = useritem.uadevice.S;
                  _uabrowser = useritem.uabrowser.S;
                  _ipaddress = useritem.ipaddress.S;
                  _lastvisit = useritem.lastvisit.S;
                  _utype = Number(useritem.utype.N);
                  _powall = Number(useritem.powall.N);
                  _chgtimes = Number(useritem.chgtimes.N);
                  _regtime = _regtime.substr(0,4)+'-'+_regtime.substr(4,2)+'-'+_regtime.substr(6,2);
                  _lastvisit = _lastvisit.substr(4,2)+'-'+_lastvisit.substr(6,2)+' '+_lastvisit.substr(8,2)+':'+_lastvisit.substr(10,2);
                  result.items.push({id:_id,regtime:_regtime,lastvisit:_lastvisit,utype:_utype,powall:_powall,
                      uadevice:_uadevice,uabrowser:_uabrowser,ipaddress:_ipaddress,chgtimes:_chgtimes,uflag:_uflag,
                      permedcharger:_permedchargers});
                }
              } else {
                let sort = event.queryStringParameters.sort||'0';
                let idxname = 'gsi_lastvisit';
                if (sort=='1') {
                  idxname = 'gsi_regtime';
                }
                let key3 = {'utype':{ComparisonOperator:'EQ',AttributeValueList:[{N:utype}]}};
                let qryparam3 = {TableName:'evuser', KeyConditions:key3, IndexName:idxname, ScanIndexForward:false, Limit:12 };
                console.log(JSON.stringify(qryparam3));
                let searchdata = await ddbclient.send(new QueryCommand(qryparam3));
                console.log(JSON.stringify(searchdata));
                for (let i=0;i<searchdata.Items.length;i++) {
                  getparam.Key.id.S = searchdata.Items[i].id.S;
                  useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
                  if (useritem.uflag) {
                    _uflag = useritem.uflag.S;
                  } else {
                    _uflag = '-';
                  }
                  _permedchargers = [];
                  if (useritem.permedcharger && useritem.permedcharger.SS) {
                      _permedchargers = useritem.permedcharger.SS;
                  }
                  _id = useritem.id.S;
                  _regtime = useritem.regtime.S;
                  _uadevice = useritem.uadevice.S;
                  _uabrowser = useritem.uabrowser.S;
                  _ipaddress = useritem.ipaddress.S;
                  _lastvisit = useritem.lastvisit.S;
                  _utype = Number(useritem.utype.N);
                  _powall = Number(useritem.powall.N);
                  _chgtimes = Number(useritem.chgtimes.N);
                  _regtime = _regtime.substr(0,4)+'-'+_regtime.substr(4,2)+'-'+_regtime.substr(6,2);
                  _lastvisit = _lastvisit.substr(4,2)+'-'+_lastvisit.substr(6,2)+' '+_lastvisit.substr(8,2)+':'+_lastvisit.substr(10,2);
                  result.items.push({id:_id,regtime:_regtime,lastvisit:_lastvisit,utype:_utype,powall:_powall,
                    uadevice:_uadevice,uabrowser:_uabrowser,ipaddress:_ipaddress,chgtimes:_chgtimes,uflag:_uflag,
                      permedcharger:_permedchargers});
              }
                if (searchdata.LastEvaluatedKey) result.nextToken = searchdata.LastEvaluatedKey;
              }
            }
            response.body = JSON.stringify(result);
            callback(null, response);
        } else if (apiname=='getcharger') {
          let result = {mac:'',guestok:1,gunstyle:1,gunstandard:0,connected:0,ver:'0.0.0',swk:0,stp:0,dor:0,lgd:0,sta:[0,0],pwa:[0,0],ixa:[0,0],tpa:[0,0],cpa:[0,0],cza:[0,0],pva:[0,0]};
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
            result.guestok = Number(iotdata.attributes.guestok);
            result.gunstyle = Number(iotdata.attributes.gunstyle);
            result.gunstandard = Number(iotdata.attributes.gunstandard);
            result.connected = Number(iotdata.attributes.connected);
            result.swk = Number(iotdata.attributes.swk);
            result.imax = iotdata.attributes.imax.split(',');
            result.ver = iotdata.attributes.fmver;
            if (result.gunstyle==1) {
                gunid = 1;
            } else if (result.gunstyle==2) {
                gunid = 0;
            } else {
                if (gunid==-1) gunid = 0;
            }
            let shadow = await iotdataclient.send(new GetThingShadowCommand(descparam));
            let payload = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(shadow.payload)));
            result.stp = payload.state.reported.stp;
            result.dor = payload.state.reported.dor;
            result.lgd = payload.state.reported.lgd;
            result.tpa = [payload.state.reported.tp0-100,payload.state.reported.tp1-100];
            result.swa = [payload.state.reported.sw0,payload.state.reported.sw1];
            result.pwa = [payload.state.reported.pw0,payload.state.reported.pw1];
            result.ixa = [payload.state.reported.ix0,payload.state.reported.ix1];
            result.cpa = [payload.state.reported.cp0,payload.state.reported.cp1];
            result.cza = [payload.state.reported.cz0,payload.state.reported.cz1];
            result.sta = [payload.state.reported.st0,payload.state.reported.st1];
            result.pva = [payload.state.reported.pv0,payload.state.reported.pv1];
            result.cpa[0] = (result.cpa[0]/10).toFixed(1);
            result.cpa[1] = (result.cpa[1]/10).toFixed(1);
            result.cza[0] = (result.cza[0]/10).toFixed(1);
            result.cza[1] = (result.cza[1]/10).toFixed(1);
            result.imax[0] = Number(result.imax[0]);
            result.imax[1] = Number(result.imax[1]);
            result.ixa[0] = (result.ixa[0]/1000).toFixed(1);
            result.ixa[1] = (result.ixa[1]/1000).toFixed(1);
            if ( result.pwa[0] < 10000 ) {
                result.pwa[0] = (result.pwa[0]/1000).toFixed(3);
            } else if ( result.pwa[0] < 100000 ) {
                result.pwa[0] = (result.pwa[0]/1000).toFixed(2);
            } else if ( result.pwa[0] < 1000000 ) {
                result.pwa[0] = (result.pwa[0]/1000).toFixed(1);
            } else {
                result.pwa[0] = (result.pwa[0]/1000).toFixed(0);
            }
            if ( result.pwa[1] < 10000 ) {
                result.pwa[1] = (result.pwa[1]/1000).toFixed(3);
            } else if ( result.pwa[1] < 100000 ) {
                result.pwa[1] = (result.pwa[1]/1000).toFixed(2);
            } else if ( result.pwa[1] < 1000000 ) {
                result.pwa[1] = (result.pwa[1]/1000).toFixed(1);
            } else {
                result.pwa[1] = (result.pwa[1]/1000).toFixed(0);
            }
            for (let i=0;i<2;i++) {
              if (result.sta[i]==null || result.sta[i]=='null' || result.sta[i]=='NaN') result.sta[i] = 0;
              if (result.swa[i]==null || result.swa[i]=='null' || result.swa[i]=='NaN') result.swa[i] = '-';
              if (result.pwa[i]==null || result.pwa[i]=='null' || result.pwa[i]=='NaN') result.pwa[i] = '-';
              if (result.ixa[i]==null || result.ixa[i]=='null' || result.ixa[i]=='NaN') result.ixa[i] = '-';
              if (result.cpa[i]==null || result.cpa[i]=='null' || result.cpa[i]=='NaN') result.cpa[i] = '-';
              if (result.cza[i]==null || result.cza[i]=='null' || result.cza[i]=='NaN') result.cza[i] = '-';
              if (result.pva[i]==null || result.pva[i]=='null' || result.pva[i]=='NaN') result.pva[i] = '-';
            }
            if ( result.connected ) {
              if ( result.stp ) {
                result.stateid = 5;
              } else if ( result.sta[gunid] == 0 ) {
                if ( payload.state.reported['cp'+gunid] >50 && payload.state.reported['cp'+gunid] < 98 ) {
                  result.stateid = 1;  //readygunin
                } else {  //没有插枪，空闲 readyfree
                  if ( result.lgd == 1 ) {  //接地良好
                    result.stateid = 0;
                  } else {
                    result.stateid = 4;
                  }
                }
              } else if ( result.sta[gunid] == 1 ) {
                result.stateid = 2;
              } else if ( result.sta[gunid] == 6 ) {
                result.stateid = 3;
              } else {
                result.stateid = 2;
              }
            } else {
              result.stateid = 6;
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
            let chargerid = iotdata.attributes.chargerid;
            if ( guestok == '0' ) {
              if ( useritem ) {
                errcode = 3;
                //设备设置为授权启动，但用户账号不在授权列表中
                if ( useritem.permedcharger && useritem.permedcharger.SS && useritem.permedcharger.SS.contains(chargerid) ) {
                    errcode = 0;
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
            let updateparam = { TableName: 'evuser', Key: {id:{S:uid}},
              UpdateExpression: 'SET chgtimes=chgtimes+:add',
              ExpressionAttributeValues:{':add':{N:'1'}}
            };
            await ddbclient.send(new UpdateItemCommand(updateparam));  
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
        } else if (apiname=='setguestok') {  //0,1
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
        } else if (apiname=='setimax') {  //imax=32,16
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype == 9 ) {
            let imax = event.queryStringParameters.imax;
            let mac = event.queryStringParameters.mac;
            let updatethingParams = {
              thingName: mac,
              attributePayload: {
                attributes: {
                  'imax': imax
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
            imax = imax.split(',');
            for (let i=0;i<imax.length;i++) {
              imax[i] = Number(imax[i]);
            }
            let pubparam = {
              topic: 'xniot/work/'+mac,
              payload: Buffer.from(JSON.stringify({'limit':imax})),
              qos: 1
            };
            try {
              await iotdataclient.send(new PublishCommand(pubparam));
            } catch (err) {
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
            let otaid;
            if (cmdid==1) {
              let ver = event.queryStringParameters.ver;
              ver = ver.replace(/\./g,'');
              ver = Number(ver);
              let newver = ver+1;
              ver = ver.toString().split('');
              newver = newver.toString().split('');
              otaid = 'evfw_ota_'+ver[0]+'_'+ver[1]+'_'+ver[2]+'_to_'+newver[0]+'_'+newver[1]+'_'+newver[2];
              try {
                await iotclient.send(new GetOTAUpdateCommand({otaUpdateId:otaid}));
                pubparam = {
                    topic: 'xniot/work/'+mac,
                    payload: Buffer.from(JSON.stringify({'cmd':'update'})),
                    qos: 1
                };
              } catch (err) {
                  pubparam  = undefined;
              }
            } else if (cmdid==2) {
              pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'cmd':'reboot'})),
                qos: 1
              };
            } else if (cmdid==3) {
              pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'beep':3})),
                qos: 1
              };
            } else if (cmdid==4) {
              pubparam = {
                topic: 'xniot/work/'+mac,
                payload: Buffer.from(JSON.stringify({'clnpon':0})),
                qos: 1
              };
            }
            try {
              if (cmdid==1 && pubparam==undefined) {
                pubparam = {
                    topic: 'xniot/work/'+mac,
                    payload: Buffer.from(JSON.stringify({'beep':9})),
                    qos: 1
                };
                ret.rc = -3;
                ret.rm = 'OTA ['+otaid+'] not found, create first!';
              }
              await iotdataclient.send(new PublishCommand(pubparam));
            } catch (err) {
              ret.rc = -2;
              ret.rm = 'Message send failed!';
              console.log(err);
            }
          } else {
            ret.rc = -1;
            ret.rm = 'NOT allowed!';
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='savepermedcharger') {
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype == 9 ) {
            let uid = event.queryStringParameters.uid;
            let permed = event.queryStringParameters.permed;
            if (permed && permed.length>5) {
                permed = permed.split(',');
                let updateparam = { TableName: 'evuser', Key: {id:{S:uid}},
                    UpdateExpression: 'SET permedcharger=:permd',
                    ExpressionAttributeValues:{':permd':{SS:permed}}
                };
                await ddbclient.send(new UpdateItemCommand(updateparam));
            } else {
                let updateparam = { TableName: 'evuser', Key: {id:{S:uid}},
                    UpdateExpression: 'REMOVE permedcharger'
                };
                await ddbclient.send(new UpdateItemCommand(updateparam));
            }
            ret.rc = 1;
          } else {
            ret.rc = -1;
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='removeone') {
          let ret = {rc:0};
          let uid = event.queryStringParameters.userid;
          let getparam = { TableName: 'evuser', Key: {id:{S:uid}} };
          let useritem = (await ddbclient.send(new GetItemCommand(getparam))).Item;
          let usertype = 0;
          if (useritem) usertype = useritem.utype.N;
          if ( usertype == 9 ) {
            let rid = event.queryStringParameters.id;
            let removeparam = { TableName: 'evuser', Key: {id:{S:rid}} };
            await ddbclient.send(new DeleteItemCommand(removeparam));
            ret.rc = 1;
          } else {
            ret.rc = -1;
          }
          response.body = JSON.stringify(ret);
          callback(null, response);
        } else if (apiname=='index.html') {
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
          let nowtmstr = moment(new Date().getTime()).tz(config.TZ).format(config.TF);
          response.headers['content-type'] = 'text/html';
          response.body = '<b>xiaoniu EvCharger AppServer.</b><br/>Author: Shenzhen Xiaoniu New Energy Company.<br/>TimeNow: ' + nowtmstr + '<br/>AppVer: ' + config.APIVERSION + '<br/>YourIP: ' + ipaddress + '<br/>Browser: ' + uadevice + '/' + uabrowser;
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
