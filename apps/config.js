/**
Copyright 2022 ShenZhen Xiaoniu New Energy Inc. All Rights Reserved.
Author: saico@mosf.cn
**/
const axios = require('axios');

const TX_IP2CITY = 'https://apis.map.qq.com/ws/location/v1/ip?key=FWkkkk2BJO&ip=';

module.exports = {

    TZ: 'Asia/Shanghai',

    APIVERSION: '0.0.1',

    DEFAULT_GUESTOK: process.env.default_guestok,
    MAX_RESULTS: process.env.Max_Results,
    DEFAULT_GUESTOK: process.env.Default_Guestok,
    DEFAULT_THINGTYPE: process.env.Default_ThingType,
    DEFAULT_CHARGERTYPE: process.env.Default_Chargertype,
    DEFAULT_GUNSTANDARD: process.env.Default_Gunstandard,
    AWS_REGION: process.env.AWS_Region,
    DEFAULT_LOGO: process.env.Default_Logo,
    DDB_SERVER_URL: process.env.DDB_Server_URL,
    IOT_SERVER_URL: process.env.IOT_Server_URL,
    IOT_DATA_ENDPOINT: process.env.IOT_Data_ENDPOINT,
    RESTORE_USERID: process.env.Restore_Userid,  //将指定的用户ID写入客户端浏览器以实现用户账户恢复,NONE不处理

    shadowkeys: {'stp':0,'dor':1,'tp0':2,'tp1':3,'ix0':4,'ix1':5,'ix2':6,'st0':7,'st1':8,'st2':9,'sw0':10,'sw1':11,'sw2':12},
    shadowkeydesc: ['STOP','DOOR','TEMP','TEMP','ECURRENT0','ECURRENT1','ECURRENT2','GUNSTATE0','GUNSTATE1','GUNSTATE2','GUNSWITCH0','GUNSWITCH1','GUNSWITCH2'],

    DD: 'YYYY-MM-DD',
    SF: 'YYYYMMDDHHmmss',
    TF: 'YYYY-MM-DD HH:mm:ss',
    D2: 'MM-DD_HH:mm:ss',

    POLICY_DOCUMENT: 
`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iot:Connect",
        "iot:Receive",
        "iot:Publish",
        "iot:Subscribe",
        "iot:UpdateThingShadow",
        "iot:DeleteThingShadow"
      ],
      "Resource":[
        "arn:aws:iot:ap-northeast-2:111:client/$\{iot:Connection.Thing.ThingName\}",
        "arn:aws:iot:ap-northeast-2:111:thing/$aws/things/$\{iot:Connection.Thing.ThingName\}/*",
        "arn:aws:iot:ap-northeast-2:111:topic/$aws/things/$\{iot:Connection.Thing.ThingName\}/*",
        "arn:aws:iot:ap-northeast-2:111:topic/xniot/dtos/$\{iot:Connection.Thing.ThingName\}",
        "arn:aws:iot:ap-northeast-2:111:topic/xniot/work/$\{iot:Connection.Thing.ThingName\}",
        "arn:aws:iot:ap-northeast-2:111:topicfilter/$aws/things/$\{iot:Connection.Thing.ThingName\}/*",
        "arn:aws:iot:ap-northeast-2:111:topicfilter/xniot/dtos/$\{iot:Connection.Thing.ThingName\}",
        "arn:aws:iot:ap-northeast-2:111:topicfilter/xniot/work/$\{iot:Connection.Thing.ThingName\}"        
      ]
    }
  ]
}`,
    ROOT_CA_URL: 'https://www.amazontrust.com/repository/AmazonRootCA1.pem',


    getipcity: async function (ip) {
      let url = TX_IP2CITY + ip;
      console.log(url);
      let axresp = await axios.get(url);
      let data = axresp.data;
      if (data.status>0) {
          return data.message;
      } else {
          let province = data.result.ad_info.province;
          let city = data.result.ad_info.city + data.result.ad_info.district;
          if (city == '') city = province;
          if (city == '') city = '-';
          return city;
      }
    },

};
