#!/bin/sh
echo
echo
echo ......................................
echo "Default for all in guided except 'iotappFunction may not have authorization defined, Is this okay?' SAY 'y' "
echo
echo
cd dependencies/nodejs
npm install --save
cd ../..
aws iot create-thing-type \
    --thing-type-name "XNEVBK" \
    --thing-type-properties "thingTypeDescription=Created by ShenZhen Xiaoniu Company (www.mosf.cn),searchableAttributes=chargerid,connected,onltime"
sam build
sam deploy --guided
rm xniotsamapp.yaml
