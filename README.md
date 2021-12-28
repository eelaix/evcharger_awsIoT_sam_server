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
3. 可以在全球AWS服务器上部署，支持一键部署
4. 硬件设备支持WIFI联网，支持离线使用，支持即插即用，离线使用的情况下不能做身份认证
5. 硬件设备只需一个跳线帽即可切换至非即插即和状态，方便变更为身份认证启动
5. 后台软件稍做修改即可实现计费功能，本软件暂未实现
6. 硬件设备支持多用电模式，接受客户定制，支持三相单枪，单相单枪，单相双枪和单相三枪
7. 每一路输出最大7KW，三相单枪可达21KW
8. 支持多种交流充电桩国际标准，包括美标，欧标及中国大陆国标
9. 可支持十路电动单车充电桩


# 程序部署 （Install)

第一步：注册aws账号

访问 https://www.amazonaws.cn/ 注册中国区账号  或者
访问 https://aws.amazon.com/   注册全球账号

第二步：在本地电脑设置使用环境

第三步：安装充电桩平台软件

访问以下网址可实现一键安装
https://console.amazonaws.cn/lambda/home?region=cn-north-1#/create/app?applicationId=arn:aws-cn:serverlessrepo:cn-north-1:864245259608:applications/EvChargerPlatform
