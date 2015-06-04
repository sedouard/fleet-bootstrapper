var inquirer = require('inquirer');
var fs = require('fs');
var RSVP = require('rsvp');
var unirest = require('unirest');
var readFile = RSVP.denodeify(fs.readFile);
var writeFile = RSVP.denodeify(fs.writeFile);
var execSync = require('child_process').execSync;
var paramData;
var readParams;
var discoveryUrl;

readFile('./deploy-params-template.json', {encoding: 'utf8'})
.then(function(data){
  data = data.trim();
  var params = JSON.parse(data);
  readParams = params;
  var filledParams = {};
  var prompts = [];
  for(var i in params) {
    if(params[i].value !== '') {
      filledParams[i] = params[i];
    }
    else if (i !== 'sshKeyData' && i !== 'customData') {
      prompts.push({
        type: 'input',
        name: i,
        message: 'Please specify a value for deployment parameter: ' + i
      });
    }
  }

  return new RSVP.Promise(function (resolve) {

    inquirer.prompt(prompts,
    function(answers){
      for(var i in answers){
        filledParams[i] = {};
        filledParams[i].value = answers[i];
      }
      return resolve(filledParams);
    });

  });
  
})
.then(function(params){
  paramData = params;

  return new RSVP.Promise(function(resolve, reject){

    unirest.get('https://discovery.etcd.io/new?size=' + paramData.numberOfNodes.value)
    .end(function(response) {

      if(response.error) {
        return reject(response.error);
      }

      return resolve(response.body);

    });

  });
})
.then(function (url) {
  discoveryUrl = url;
  return readFile('./cloud-config-template.yaml', { encoding:'utf8' });

})
.then(function(data){

  var cloudConfigData = data.replace('<DISCOVERY_URL>', discoveryUrl);
  
  console.log('Stuffing this cloud-config yaml into template as a base64 encoded string:');
  console.log(cloudConfigData);
  cloudConfigData = new Buffer(cloudConfigData).toString('base64');

  if (paramData.customData !== undefined) {
    return;
  }

  paramData.customData = {};
  paramData.customData.value = cloudConfigData;

  // now generate the ssh key data if non-existent
  if (!fs.existsSync('./ssh-cert.pem')) {
    console.log('generating new ssh key...');
    execSync('openssl req -x509 -nodes -days 365 -newkey rsa:2048 -config cert.conf -keyout ssh-cert.key -out ssh-cert.pem');
    execSync('chmod 600 ssh-cert.key');
    execSync('openssl  x509 -outform der -in ssh-cert.pem -out ssh-cert.cer');
  }
  console.log('using existing ssh key ./ssh-cert.pem');
  return readFile('./ssh-cert.pem', { encoding: 'utf8' });
})
.then(function (data) {

  var parts = data.split('\n');
  var key = "";
  for (var i in parts) {
    if (i % 1 === 0) {
      if( parts[i].indexOf('-----BEGIN CERTIFICATE-----') < 0 &&
        parts[i].indexOf('----END CERTIFICATE-----') < 0) {
          key += parts[i];
        }
    }
  }
  console.log('using ssh key data:');
  console.log(key);

  paramData.sshKeyData = {};
  paramData.sshKeyData.value = key;

  return writeFile('./azure-deploy-params.json', JSON.stringify(paramData, null, 2));
})
.then(function (){
  console.log('sucessfully prepared azure-deploy-params.json');
})
.catch(function(err){
  console.log(err);
  console.error(err.stack);
});