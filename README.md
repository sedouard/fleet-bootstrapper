# Docker Fleet Starter

This is a package/guide on how to boot-strap your CoreOS backend with scalable Web microservices uses Fleet, and Etcd. We use a private portable docker registry which is backed by Azure Storage.

## Components

This Fleet Starter package has all the things you need to deploy and scale web applications and services using Docker and CoreOS. It includes 3 components:

- **Registry**: A portable private registry backed by [Azure Storage](), all apps and the **router** are deployed from here.
- **Router**: An Nginx Router which dynamically routes your web apps as you deploy them using [conf.d]() and [etc]()
- **Example App** An example [Node.js Express]() applciation which can be deployed

## How it Works

Fleet Starter uses the Azure Storage [storage adapter]() to build a [docker registry]() server which is portable. Because of this we can deploy a light-weight registry server and push and pull images by appending `localhost:5000` to our private image names. We provision a CoreOS cluster and deploy our private registry image from our single free private repository to each of our CoreOS nodes.

### Deployment

![](img/ss1.png)

In the image above, we use our no-cost single docker repository to store the docker image of our docker registry server. The server is built with our Azure storage credentials and can be ran from anywhere with an internet conneciton.

This enables the architecture in the graphic above which allows us to deploy our registry as a fleet [global service](), which basically means one registry server runs on every server. This is because docker requires images in private repostiories be tagged with the name of their host. By hosting a light-weight registry server on each CoreOS instance we greatly simplify deploying images.

Once our registry service is deployed across the cluster with fleet, we can deploy any image within that registry as a service on the cluster. The graphic above depics the scenario of a developer, running a registry on their local machine and pushing the image to azure storage. The service is then restarted and the new image is deployed to the appropiate nodes.

Using an external image store allows us to run a private docker image repository without ever having to worry about SSL and authenticating users to our repository. We also get the advantage of the redundancy and backup features of Azure Storage.

### Service Discovery

CoreOS uses [etcd](), a demon service which is essentially a distributed key-value store which allows services to announce their presence by publishing keys with a TTL. Each deployed application instance is deployed with an accompanying 'announcer' service which is simply a bash script that periodically writes its host ip address and port number for it's cooresponding web server.

![](img/ss2.png)

In the graphic above each **router** instance subscribes to etcd and it uses published keys in etcd to build its routing and load balancing rules. For example, **App1** exists on the first two VMs and between the two instances their cooresponding 'sidekick' services update the service directory key `App1` with the key-value pairs `@1: 192.168.1.1:3000` and `@2 192.168.1.2:3000`. Because the **nginx** router is subscribed to etcd it automatically rebuilds its routing temaplte. Requests going for **app1** will route to either of these two machines in a round-robin load balancing manner. The same goest for App2 - this design allows for any number of applications to be deployed in a load-balanced manner.

Fleet allows us to specifically define 'sidekick' services which are gauranteed to run on the same machine as the service it monitors. When the accompanying application service goes down so does the sidekick service. This keeps etcd up-to-date in the case of applciation updates and restarts.

Here's what the App1 [service file](example-app/example-app@.service) looks like:

```fleet
# example-app@.service
# the '@' in the file name denotes that this unit file is a model
Description=Example High-Availabilty Web App
After=router.service

[Service]
EnvironmentFile=/etc/environment
ExecStartPre=/usr/bin/docker pull localhost:5000/example-app:latest
ExecStart=/usr/bin/docker run --name example -p 3000:3000 localhost:5000/example-app:latest
ExecStop=/usr/bin/docker stop example
ExecStopPost=/usr/bin/docker kill example
ExecStopPost=/usr/bin/docker rm example

[X-Fleet]
Conflicts=example-app@*.service
```

This [Unit File](https://coreos.com/docs/launching-containers/launching/fleet-unit-files/) refers to the docker image `example-app` in our private azure docker registry. To start this unit we simply do:

```
# uplaod the service model to fleet
fleetctl submit example-app@.service
# start an instance of the service
fleetctl start example-app@1.service
```

The `X-Fleet Conflicts` tag in the unit file instructs `fleet` that we don't want more than one of this unit running on the same machine in order to have high availability.

### Routing & Load Balancing

The entire cluster sits behind a load balancer and has one public virtual IP address. This public IP address points to an Azure load balancer which serves requests to any of of our nodes.

![](img/ss3.png)

When a user request comes in, because we have the **router** running and listening on port 80 and port 443 on each node we can handle the request no matter what node it comes to. Further, because of **etcd** service discovery each router has knowledge about where all the services are located and can route the request the appropiate container.

![](img/ss4.png)

This means that the actual container which provides the service doesn't necessarily need to be on the machine that the Azure load balancer selects.

![](img/ss5.png)

Furthermore, the Azure load balancer load balances requests amongst our router, but each **router** service unit load balances the containers for each service.
  
## How to Deploy High Availabilty Apps to [Azure](http://azure.com) using [CoreOS](http://coreos.com) with [Fleet](https://github.com/coreos/fleet) & [Etcd](http://github.com/coreos/etcd)

This repository has everything you need to implement the architecture layed out above.

### Provisioning CoreOS

CoreOS, an operating system for distributed clusters will be required. [Fleet]() and [etcd]() services will be included automatically by our `contrib/azure/cloud-config.yaml`.

#### Azure

##### Authentication

First after you have an Azure account, you'll need to setup an *Azure Active Directory* to login to your subscription from the CLI. First go to the classic portal at [manage.windowsazure.com](https://manage.windowsazure.com).

On the left ribbon, select 'Active Directory' to pull up the active directories dashboard. Check to see that there isn't already an existing Azure Active Directory (AAD) with the smae name as your subscription. For example, if you signed up for Azure with `steven@gmail.com` an existing directory would be `stevengmail.onmicrosoft.com`.

To create a new AAD for your current subscription, make sure you are logged in as the primary azure administrator and click the '+' on the bottom left and select a new directory and click 'Custom Create':

![](img/ss7.png)

Select the name of your directory which should be the same name as the directory on your subscription. You can find the name on the top right of the portal dashboard:

![](img/ss8.png) 

![](img/ss11.png)

After you've created your subscription you can add a new user to it. It doesn't matter what the user name is:

![](img/ss12.png)

You'll get a temporary password for the user:

![](img/ss6.png)

Open up a new in-private/incognito browser window, then go to [manage.windowsazure.com](http://manage.windowsazure.com) and authenticate with the username and password. It'll then prompt you to change the password.

Now you can login to that account using the azure cli:

```
# install the cli if you don't already have it
npm install azure-cli -g
azure login
username: someuser@stevegmail.onmicrosoft.com
password: ***
-info:    Added subscription Windows Azure MSDN - Visual Studio Ultimate       
info:    Setting subscription Windows Azure MSDN - Visual Studio Ultimate as default
+
info:    login command OK
```

##### Provisioning the template

To provision your CoreOS cluster, first modify the [`./contrib/azure/cert.conf`](./contrib/azure/cert.conf) with your organization details for the ssh keys to be generated for your new machines:

```
[ req ]
prompt = no
default_bits = 2048
encrypt_key = no
distinguished_name = req_distinguished_name

string_mask = utf8only

[ req_distinguished_name ]
O=My Company
L=San Francisco
ST=CA
C=US
CN=www.test.com
```

It's not very important what the actual names are, since we won't be using these keys for SSL, but just the ssh connection. Now go into the `./contrib/azure` directory and you can choose to modify the CoreOS template [parameters file](./contrib/azure/deploy-params-template.json) or you can enter them when you execute `gentemplate.js`:

```
{
    "newStorageAccountName": {
        "value": ""
    },
    "publicDomainName": {
        "value": ""
    },
    "vmSize": {
        "value": "Standard_A3"
    },
    "adminUserName": {
        "value": "core"
    },
    "sshKeyData": {
        "value": ""
    },
    "customData": {
        "value": ""
    },
    "numberOfNodes": {
        "value": 3
    }
}

```

Now execute the parameters file generation script:

```
# generate parameters file
cd ./contrib/azure
node gentemplate.js
```

Depending on what you filled out in `./contrib/azure/deploy-params-template.json` you may or may not be prompted for paramter values. This script will generate new ssh key if `./contrib/azure/ssh-key.pem` doesn't exist as well as generate a new discovery token link for coreos, base64 encode both of these and place them in the template file.

Now, create a new resource, and deploy the template:

```
azure create group someresourcegroup
azure group deployment create someresourcegroup --template-file azuredeploy.json --parameters-file azure-deploy-params.json
info:    Executing command group deployment create
+ Initializing template configurations and parameters                          
+ Creating a deployment                                                        
info:    Created template deployment "azuredeploy"
+ Registering providers                                                        
data:    DeploymentName     : azuredeploy
data:    ResourceGroupName  : sedouard-fleet-bootstrap
data:    ProvisioningState  : Accepted
data:    Timestamp          : 2015-06-04T20:44:16.2904614Z
data:    Mode               : Incremental
data:    Name                   Type    Value
...
info:    group deployment create command OK
```

You can check the status of the deployment at [portal.azure.com](https://portal.azure.com) by checking under 'Resource Groups'.

After the resource group is provisioned you can access your nodes by doing:

```
# add the ssh identity
ssh-add ./ssh-cert.key
ssh core@sedouard-fleet-bootstrap.westus.cloudapp.azure.com -p 22000
```
Replace `westus` with the name of the datacenter you deployed to and `adminUserName` with your actual admin user name specified by the parameters json. Because we are behind a public load balancer you must access your machines SSH ports starting from 22000 => Node0, 22001 => Node2, etc.

### Starting the Private Docker Repo

We'll need to create a registry that fleet can deploy our apps from. To do this we'll use the Azure Storage [adapter](http://azure.microsoft.com/blog/2014/11/11/deploying-your-own-private-docker-registry-on-azure/) for the docker registry server in order to keep our image data in one central place.

To build the registry which is backed by azure storage just do:

```
cd ./registry
docker build -t <docker_hub_username>/registry:latest .
```
The `:latest` part is just a tag for the image and can be an arbitrary name.

Ensure you have an account at [hub.docker.com](http://hub.docker.com) and create a repository, it can be public or private. We'll use this repo to host our own private registry server image. Keep in mind, there isn't any private information in the image so its fine to use a public image.

Finally just do `docker push <docker hub username>/<name of docker repo>:latest`. After some time your private registry image will be in your repository hosted by docker hub. This will allow your private registry to be easily deployed.

#### Deploying the private registry

To deploy the private registry we'll use the unit file [registry/registry.service](./registry/registry.service):

```fleet
Description=Private Azure-backed Docker Registry
After=docker.service

[Service]
ExecStartPre=/usr/bin/docker login -u DOCKER_HUB_USER -p <<DOCKER_HUB_PASSWORD>> -e <<DOCKER_HUB_EMAIL_ADDRESS>>
ExecStartPre=/usr/bin/docker pull sedouard/registry:latest
ExecStart=/usr/bin/docker run --name registry -p 5000:5000 <your_dockerhub_username>/registry:latest -e SETTINGS_FLAVOR=azureblob -e AZURE_STORAGE_ACCOUNT_NAME="<account name>" -e AZURE_STORAGE_ACCOUNT_KEY="<account key>" -e AZURE_STORAGE_CONTAINER=registry
ExecStop=/usr/bin/docker stop registry
ExecStopPost=/usr/bin/docker kill registry
ExecStopPost=/usr/bin/docker rm registry

[X-Fleet]
Global=true
```

You should replace the `<>` tagged portions with your docker account and azure storage account credentials. It's also possible to expose environment variables by provisioning CoreOS with an `EnvironmentFile` at `etc/environment` and specifying the file for the `EnviornmentFile` key in the `[Service]` section of the unit file.

You can also simply replace these values at deployment time by writing a script that inserts the actual credentials.

To deploy the registry you should first install the `fleetctl` client locally. You can build `fleetctl` and install it easily on OSX by doing:

```
brew install fleetctl
```

Otherwise its pretty easy to build fleetctl from [source](https://github.com/coreos/fleet) sometimes you'll need to do this even on OSX if the version you need isn't listed in homebrew.

```bash
cd ./registry
# Fleetctl will load the unit file and start the service on all machines
fleetctl start registry.service
```

The service will first pull the latest registry image from the Docker hub hosted repository, and then run it as a local service for each node. After a couple minutes ( the first time takes the longest since the images have to be pulled from Docker hub ) you should see the registry units running with the `list-units` command:

```
fleetctl list-units
registry.service		110dea21.../100.73.38.124	active	running
registry.service		8abff2e7.../100.73.4.95		active	running
registry.service		b5815f25.../100.73.54.68	active	running
```

Fleet knows to deploy the registry to each node because of hte `Global=true` setting in the unit file.

### Deploying the Router

Now that our private registry is up, we can deploy our router image to the cluster via the private registry. This will allow for us to deploy web applications.

First you'll need to build the router. The router is an [nginx](http://nginx.com) server with a configuration file that is dynamically updated from changes in `etcd` using a [confd](https://github.com/kelseyhightower/confd) template in [nginx/templates/apps.tmpl](nginx/templates/apps.tmpl):

```
{{ if ls "/services/web" }}

  {{range $dir := lsdir "/services/web"}}
    
    upstream {{base $dir}} {
      {{$custdir := printf "/services/web/%s/*" $dir}}
      {{ range gets $custdir }}
        server {{ .Value }};
      {{ end }}
    }

    server {
      listen 80;
      server_name {{base $dir}}.<<YOUR_DOMAIN_NAME>>.com;
     
      #ssl on;
      #ssl_certificate /etc/ssl/certs/mycert.crt;
      #ssl_certificate_key /etc/ssl/private/mykey.key;
      #ssl_protocols       TLSv1 TLSv1.1 TLSv1.2;
      #ssl_ciphers         HIGH:!aNULL:!MD5;
     
      access_log /var/log/nginx-servicename-access.log;
      error_log /var/log/nginx-servicename-error.log;
     
      location / {
        proxy_pass http://{{base $dir}}/;
        proxy_http_version 1.1;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503 http_504 http_404;
      }
    }
  {{ end }}
{{ end }}

server {
    listen       80;
    server_name  captainkaption.com;

    location / {
        root   /usr/share/nginx/html;
        index  index.html index.htm;
    }

    #error_page  404              /404.html;

    # redirect server error pages to the static page /50x.html
    #
    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }
}
```

Using the above the nginx [`confd`](https://github.com/kelseyhightower/confd) template configuration file `apps.conf` will be generated. So you can deploy any number of applications with any number of instances per app and nginx will automatically update its configuration to route your new app and instances appropiately as their status changes in the `etcd` registry.

To deploy the nginx router, modify the template with your domain name and build the image:

```bash
cd ./router
docker build -t localhost:5000/nginx_lb_router:latest .
```
Note: You **must** use your own domain name.

Now to deploy the image you'll have to startup the registry server locally by running the registry docker file and then pushing the image. Note: if you're on boot2docker (Windows and OSX, you'll have to log into the boot2docker vm to do this):

```bash
docker run <docker hub username>/<name of docker repo>:latest
# if you're not on linux, you'll have to ssh into the boot2docker vm
boot2docker ssh
# now push the image to azure storage via the local registry server
docker push localhost:5000/nginx_lb_router:latest
```

Now, to deploy the router, we'll use the router unit file [router/router.service](router/nginx_lb_router.service):

```fleet
Description=Nginx Load Balancer and Router
After=registry.service

[Service]
EnvironmentFile=/etc/environment
ExecStartPre=/usr/bin/docker pull localhost:5000/nginx_lb_router:latest
ExecStart=/usr/bin/docker run --name router -p 80:80 -p 443:443 -e "HOST_IP=${COREOS_PRIVATE_IPV4}" -e ETCD_PORT=4001 localhost:5000/nginx_lb_router:latest
ExecStop=/usr/bin/docker kill router
ExecStopPost=/usr/bin/docker rm router

[X-Fleet]
Global=true
```

This unit file passes the port number of etcd as well as connects the router to the cluster's port 80 & 443 in order to handle web traffic from users. When the service starts it will pull the image pushed in the previous step locally by the running `registry` server instance on the machine.

To deploy the router on the server just do:

```fleet
cd ./router
fleetctl start nginx_lb_router
```

After some time, you'll see the `nginx_lb_router` service running on each node.

```
fleetctl list-units
nginx_lb_router.service		110dea21.../100.73.38.124	active	running
nginx_lb_router.service		8abff2e7.../100.73.4.95		active	running
nginx_lb_router.service		b5815f25.../100.73.54.68	active	running
registry.service		110dea21.../100.73.38.124	active	running
registry.service		8abff2e7.../100.73.4.95		active	running
registry.service		b5815f25.../100.73.54.68	active	running
```

Now the cluster is ready to start running web applications (and non-web applications, too).

### Deploying a High Availability App

This repo comes with a simple Node.js express application to demonstrate how to deploy an application. To deploy the application you'll need to build and push the image for the app as we did with the router:

```
cd ./example-app
docker build -t localhost:5000/example-app:latest
# log into boot2docker, Windows & OSX Only
boot2docker ssh
docker push localhost:5000/example-app:latest
```

Now we'll use the fleet unit file [example-app/example-app@.service](example-app/example-app@.service):

```fleet
Description=Example High-Availabilty Web App
After=router.service

[Service]
EnvironmentFile=/etc/environment
ExecStartPre=/usr/bin/docker pull localhost:5000/example-app:latest
ExecStart=/usr/bin/docker run --name example -p 3000:3000 localhost:5000/example-app:latest
ExecStop=/usr/bin/docker stop example
ExecStopPost=/usr/bin/docker kill example
ExecStopPost=/usr/bin/docker rm example
TimeoutStartSec=30m

[X-Fleet]
Conflicts=example-app@*.service
```

As mentioned in the **How it Works** section this unit file will create a model (indicated by the '@' in the file name) and ensure that only one instance runs per node. The app will pull from the central image store via the registry running at localhost:5000. 

Deploy 2 instances of this app by doing the following commands:

```
cd ./example-app
fleetctl submit example-app@.service
fleetctl start example-app@1
fleetctl start example-app@2
```

Now `fleetctl list-units` should show the app instances running on two different machines:

```
fleetctl list-units
example-app@1.service		110dea21.../100.73.38.124	active	running
example-app@2.service		8abff2e7.../100.73.4.95		active	running
nginx_lb_router.service		110dea21.../100.73.38.124	active	running
nginx_lb_router.service		8abff2e7.../100.73.4.95		active	running
nginx_lb_router.service		b5815f25.../100.73.54.68	active	running
registry.service		110dea21.../100.73.38.124	active	running
registry.service		8abff2e7.../100.73.4.95		active	running
registry.service		b5815f25.../100.73.54.68	active	running
```

However browsing to `example-app.your_domain_name.com` won't work because the router has no idea this app or its instances exist.

You need to deploy the 'sidekick' service for each instance defined by the unit file [./exampleapp/example-app-discovery@.service](./exampleapp/example-app-discovery@.service):

```fleet
[Unit]
Description=Announce Example App
BindsTo=example-app@%i.service
After=nginx_lb_router.service

[Service]
EnvironmentFile=/etc/environment
ExecStart=/bin/sh -c "while true; do etcdctl set /services/web/example-app/example-app@%i '${COREOS_PRIVATE_IPV4}:3000\' --ttl 60;sleep 45;done"
ExecStop=/usr/bin/etcdctl rm /services/web/example-app/example-app@%i

[X-Fleet]
MachineOf=example-app@%i.service
```

This service template will broadcast the instance under the default `/services/web` directory with the application name `example-app` and the actual key `example-app@<instance number>` with the value set to the host ip and port number of the example application. This allows nginx to build a routing template that looks something like:

```
    upstream example-app {
      
      
        server 100.73.38.124:3000;
      
        server 100.73.4.95:3000;
      
    }

    server {
      listen 80;
      server_name example-app.your_domain_name.com;
     
      #ssl on;
      #ssl_certificate /etc/ssl/certs/mycert.crt;
      #ssl_certificate_key /etc/ssl/private/mykey.key;
      #ssl_protocols       TLSv1 TLSv1.1 TLSv1.2;
      #ssl_ciphers         HIGH:!aNULL:!MD5;
     
      access_log /var/log/nginx-servicename-access.log;
      error_log /var/log/nginx-servicename-error.log;
     
      location / {
        proxy_pass http://example-app/;
        proxy_http_version 1.1;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503 http_504 http_404;
      }
    }
```

Nginx will build any number of upstreams for each application deployed. Allowing for any number of apps and instances.

The `Machineof` attribute in the service file tells fleet to place it on the same machine as the specfied service instance and the `BindsTo` attribute makes so that the sidekick will stop broadcasting if the application goes down, preventing nginx from sending requests to a dead container.

To deploy the sidekick services do:

```
cd ./example-app
fleetctl submit example-app-discovery@.service
fleetctl start example-app-discovery@1
fleetclt start example-app-discvoery@2
```

Notice now with `fleetctl list-units` the services will be running on the same machine as the running service:

```
fleetctl list-units
example-app-discovery@1.service	110dea21.../100.73.38.124	active	running
example-app-discovery@2.service	8abff2e7.../100.73.4.95		active	running
example-app@1.service		110dea21.../100.73.38.124	active	running
example-app@2.service		8abff2e7.../100.73.4.95		active	running
nginx_lb_router.service		110dea21.../100.73.38.124	active	running
nginx_lb_router.service		8abff2e7.../100.73.4.95		active	running
nginx_lb_router.service		b5815f25.../100.73.54.68	active	running
registry.service		110dea21.../100.73.38.124	active	running
registry.service		8abff2e7.../100.73.4.95		active	running
registry.service		b5815f25.../100.73.54.68	active	running
```

Run `docker exec router cat /etc/nginx/conf.d/apps.conf` to check what your rendered routing template looks like.

You can check the app is running by `curl`'ing the app address:

```
curl http://example-app.captainkaption.com     
<!DOCTYPE html><html><head><title>Express</title><link rel="stylesheet" href="/stylesheets/style.css"></head><body><h1>Express</h1><p>Welcome to Express</p></body></html>
```

Stop an instance of the application notice how the announcer sidekick service also stops. Again, use `docker exec router cat /etc/nginx/conf.d/apps.conf` to confirm that the server pool for `example-app` has shrunk to 1 instance.

```
$>docker exec router cat /etc/nginx/conf.d/apps.conf

    upstream example-app {
      
      
        server 100.73.4.95:3000;
      
    }

    server {
      listen 80;
      server_name example-app.captainkaption.com;
     
      #ssl on;
      #ssl_certificate /etc/ssl/certs/mycert.crt;
      #ssl_certificate_key /etc/ssl/private/mykey.key;
      #ssl_protocols       TLSv1 TLSv1.1 TLSv1.2;
      #ssl_ciphers         HIGH:!aNULL:!MD5;
     
      access_log /var/log/nginx-servicename-access.log;
      error_log /var/log/nginx-servicename-error.log;
     
      location / {
        proxy_pass http://example-app/;
        proxy_http_version 1.1;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503 http_504 http_404;
      }
    }
```

You can confirm the app is still running by curling the url again:

```
# we're still running!
curl http://example-app.your_domain.com
<!DOCTYPE html><html><head><title>Express</title><link rel="stylesheet" href="/stylesheets/style.css"></head><body><h1>Express</h1><p>Welcome to Express</p></body></html>
```

## Run Your App

To run your own instance of your apps just be sure to follow the same template as `example-app`. Just be sure to pick another port number besides `3000`.
