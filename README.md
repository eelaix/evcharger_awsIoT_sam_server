## 真实环境试用 说明

https://hkweb.mosf.cn/devices.html 这是一个已经部署好的真机环境 

(Demo site offline from 2023.09)

在你的电脑浏览器中第一次打开这个网页，你就已经自动登陆了，并且是超级管理员用户。

打开“客户”功能页面，是看不到超级管理员用户的。 

在同一个IP中换一台电脑或者换一个浏览器再次访问上面的地址，你将拥有普通用户功能（自动登陆），

在“客户”功能页面，超级管理员可以看到普通用户，在普通用户功能中，你可以设置用户昵称或者手机号并在超级管理页中看到。

普通用户可以启动充电，超级用户不可以（设置了授权启动【匿名充电-禁止】并且超级管理员给普通用户进行了授权）。

超级用户可以重启真实设备（环境中有一台真实设备），可以启动充电，可以做任何工作（除了升级和删除普通用户）。

https://hkweb.mosf.cn/charger.html?id=100111 这是充电桩充电软件访问地址 

以上地址也可以通过“设备管理”中点击设备编号进入。

以上地址可以复制到手机浏览器访问（注意保持同一个IP，比如局域网，否则会成为超级管理员，不要用微信访问，因为微信无法保存cookie）

通过 http://www.cli.im/url 生成二维码贴在机器上即可访问

如需要测试设备请联系我公司采购

# evcharger_awsIoT_sam_server
电动汽车充电桩服务端源代码  
https://github.com/eelaix/evcharger_awsIoT_sam_server

# evcharger_awsIoT_vue_client
电动汽车充电桩客户端源代码，包含充电启动界面及后台管理界面  
https://github.com/eelaix/evcharger_awsIoT_vue_client

# 项目简介 (Summary)

电动汽车充电桩服务端及客户端代码  
There 2 projects aimed to support AWS IoT EvCHARGER.

充电桩硬件具备以下特性：
1. 采用AWS FreeRTOS V202107
2. 完全满足AWSIoT规范
3. 可以在全球AWS服务器上部署，结合网络教程，成功部署后实现充电后台功能
4. 硬件设备支持WIFI联网，支持离线使用，支持插枪直充，离线使用无需身份认证
5. 硬件设备只需一个跳线即可在【插枪直充】和【扫码启动】之间切换
6. 扫码启动情况下，软件后台默认为无需身份认证，任何人可启动充电
7. 扫码启动情况下，后台可设置设备为授权启动，经过授权的用户可启动充电
8. 在有开发能力的情况下，稍做修改即可实现基本计费功能
9. 硬件设备支持多种用电模式，接受客户定制，支持三相单枪，单相单枪，单相双枪
10. 每一路输出最大7KW，三相单枪可达21KW，单相双枪总功率可达14KW
11. 支持多种交流充电桩国际标准，包括美标，欧标及中国大陆国标
12. 可支持十路电动单车充电桩，只能扫码启动
13. 设备不支持有线网络，不支持4G，不支持刷卡，没有屏幕显示，适合家用或运营
14. 硬件设备大批量生产可进一步降低成本，有意可联系我们

# 程序部署 （Install)

## 第一步：注册aws账号

访问 [亚马逊中国区](https://www.amazonaws.cn/) 注册中国区账号  或者  
访问 [亚马逊全球](https://aws.amazon.com/)   注册全球账号

## 第二步：在本地电脑上安装开发环境及配置

1. 安装aws cli -> [安装方法](https://aws.amazon.com/cn/cli/)
2. 本地配置文件:
```
～/.aws/config
[default]
region = cn-northwest-1
output = json
～/.aws/credentials
[default]
aws_access_key_id = [your id]
aws_secret_access_key = [your key]
```

## 第三步：进入亚马逊管理平台获取相关参数

1. 管理后台 -> AWSIoT -> 设置 -> 终端节点 得到你的物联网服务器地址，比如：xxxx.ats.iot.cn-northwest-1.amazonaws.com.cn
2. 管理后台 -> 右上角用户名 -> 复制账户数字编号(记下后面有用)
3. 查询并记录你的AWS服务所在区域代码，比如中国北京是cn-north-1,中国宁夏是cn-northwest-1
4. 打开sam项目源代码，修改apps/config.js文件，找到 POLICY_DOCUMENT 变量后面 Resource->arn后面的对应数值进行修改，比如：
arn:aws-cn:iot:cn-northwest-1:1234567888:修改为对应的值，其中非中国地区aws-cn改为aws，服务区域代码及用户账户编号对应修改
5. 打开sam项目源代码，修改template.yaml将其中的相关参数进行修改
6. 注意修改template.yaml中 AllowOrigins 对应项目
7. 申请一个域名，并在S3中创建一个存储桶，存储桶的名字是这个域名，在域名管理后台将域名CNAME到这个存储桶的WEB访问地址(存储通开启WEB访问功能)
8. 执行以下代码，创建事物类型：
```
aws iot create-thing-type \
    --thing-type-name "XNEVBK" \
    --thing-type-properties "thingTypeDescription=Created by ShenZhen Xiaoniu Company (www.mosf.cn),searchableAttributes=chargerid,connected,onltime"
```

## 第四步：安装充电桩平台软件

1. 进入sam项目源代码，进入dependencies/nodejs子目录，执行npm install --save
2. 返回sam项目源代码，执行sam build
3. 执行sam deploy --guided 进行安装
4. 如果没有正确安装，根据提示修改，安装成功后进入后台，找到APIGateway，找到HttpApi接口地址
5. 进入vue项目源代码，找到src/config.js文件，将上一步得到的接口地址填入export const BASE变量中
6. 修改vue项目go.sh其中的s3bucket修改为3.7中的域名存储桶
7. 运行./go.sh进行HTML静态页面部署

## 第五步：测试

1. http://iot.yourdomain.com/devices.html 这是你的后台管理软件地址
2. http://iot.yourdomain.com/charger.html?id=100111 这是你的充电桩充电软件访问地址
3. 通过 http://www.cli.im/url 生成二维码贴在机器上即可访问
4. 设备支持WIFI联网，可以有三种方法配网，其中方法一仅适合中国大陆地区，其他两种方法全球适用
5. 方法一，二适合知道WIFI密码的情况，方法三适合不知道WIFI密码，需要路由器上的WPS按钮配合
6. https://xs.woniuev.cn/wifisetup.html 这是WIFI配网的具体步骤和工具
7. 如需要测试设备请联系我公司采购

 https://hkweb.mosf.cn/devices.html 
 
 https://hkweb.mosf.cn/charger.html?id=100111 

