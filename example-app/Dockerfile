FROM ubuntu:trusty

MAINTAINER Steven Edouard <steven.edouard1@gmail.com>

ENV DEBIAN_FRONTEND noninteractive

RUN apt-get update -y -y 
RUN apt-get install wget -y
RUN wget http://nodejs.org/dist/v0.12.0/node-v0.12.0-linux-x64.tar.gz && sudo tar -C /usr/local --strip-components 1 -xzf node-v0.12.0-linux-x64.tar.gz
RUN apt-get install build-essential -y
RUN apt-get install libreadline-gplv2-dev libncursesw5-dev libssl-dev libsqlite3-dev tk-dev libgdbm-dev libc6-dev libbz2-dev -y
RUN wget http://python.org/ftp/python/2.7.5/Python-2.7.5.tgz && tar -xvf Python-2.7.5.tgz && cd Python-2.7.5 && ./configure && sudo make install

VOLUME ["/data"]

ADD . /data

WORKDIR /data

CMD cd /data; npm install; npm start
