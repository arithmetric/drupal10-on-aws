FROM php:8.1-apache

RUN apt-get update && \
    apt-get install -y \
            jq \
		    libfreetype6-dev \
		    libjpeg62-turbo-dev \
		    libpng-dev \
            libxml2-dev \
            mariadb-client \
            unzip \
            && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
	docker-php-ext-configure gd --with-freetype --with-jpeg && \
	docker-php-ext-install -j$(nproc) gd opcache pdo_mysql xml && \
    a2enmod rewrite

COPY php.ini-append /usr/local/etc/php

RUN cd /usr/local/etc/php && \
    cp php.ini-production php.ini && \
    echo "" >> php.ini && \
    cat php.ini-append >> php.ini

COPY docker-php-entrypoint /usr/local/bin/

RUN chmod 755 /usr/local/bin/docker-php-entrypoint

COPY docroot/ /var/www/

RUN rm -rf /var/www/html && \
    ln -s /var/www/web /var/www/html
