FROM php:8.1-apache

RUN apt-get update && \
    apt-get install -y \
            jq \
		    libfreetype6-dev \
		    libjpeg62-turbo-dev \
		    libpng-dev \
            libxml2-dev \
            unzip \
            && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
	docker-php-ext-configure gd --with-freetype --with-jpeg && \
	docker-php-ext-install -j$(nproc) gd opcache pdo_mysql xml && \
    a2enmod rewrite

COPY docroot/ /var/www/

COPY docker-php-entrypoint /usr/local/bin/

RUN rm -rf /var/www/html && \
    ln -s /var/www/web /var/www/html && \
    chmod -R 777 /var/www/html/sites/default/files && \
    chmod 666 /var/www/html/sites/default/settings.php
