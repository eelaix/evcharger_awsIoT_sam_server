#!/bin/sh
echo
echo
echo  ......................................
echo
echo
cd dependencies/nodejs
npm install --save
cd ../..
sam build
sam deploy
rm xniotsamapp.yaml
