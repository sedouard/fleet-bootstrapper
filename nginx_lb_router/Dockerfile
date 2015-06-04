FROM nginx:1.9.0
MAINTAINER Steven Edouard "sedouard@microsoft.com"
 
ADD ./*.toml /etc/confd/conf.d/


RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y install curl && curl -o /usr/bin/confd -L https://github.com/kelseyhightower/confd/releases/download/v0.7.1/confd-0.7.1-linux-amd64 && chmod 755 /usr/bin/confd 

ADD ./templates/*.tmpl /etc/confd/templates/
ADD ./templates/*.tmpl /etc/conf.d/templates/
RUN mkdir /etc/nginx/sites-enabled

ADD confd-watch /usr/local/bin/confd-watch
RUN chmod +x /usr/local/bin/confd-watch
 
EXPOSE 443
 
CMD /usr/local/bin/confd-watch
