# `ccm_data_server`
Backend script for handling database requests from [`ccm_components`](https://github.com/DigiKlausur/ccm_components).

## Initialize NPM packages
Inside the `ccm_data_server` directory, execute:
```
npm install
```

## Initialize/Reset Let's Encrypt Certificates
Largely based on the [tutorial by David Mellul](https://itnext.io/node-express-letsencrypt-generate-a-free-ssl-certificate-and-run-an-https-server-in-5-minutes-a730fbe528ca)
* Run `certbot` in manual mode as `root`
```
# certbot certonly --manual
```
* Follow the instructions to add appropriate domain names, until the window requesting for the specific file
under `<domain name>/.well-known/acme-challenge/<random file name>` with a specific random string as content.
* In another terminal, create `.well-known/acme-challenge/<random file name>` in `ccm_data_server` and add
the random string as its content
* Start [`certbot_setup.js`](./certbot_setup.js) as root:
```
# node certbot_setup.js
```
* Go back to the terminal with `certbot` command and hit `Enter`. If all is well, a message will appear saying
`Congratulations! Your certificate and chain have been saved at` with the certificate locations
* Modify [`config.json`](./config/configs.json) with the appropriate certificate paths, and the backend script is ready to go

## To start the backend script
* Modify [`config.json`](./config/configs.json) with the appropriate settings for the server
* Start [`index.js`](./index.js) as root:
```
# node index.js
```

## Start the backend script as a `systemd` service
* modify [ccm_data_server.service](./ccm_data_server.service) with appropriate system paths
* Create a symbolic link of the file [ccm_data_server.service](./ccm_data_server.service) in system service location
```
# ln -s `pwd`/ccm_data_server.service /lib/systemd/system/
```
* Allow node to bind to SSL port 443 (reqires `apt` package)
```
# setcap cap_net_bind_service=+ep `readlink -f \`which node\``
```
* Reload, enable and start the data service
```
# systemctl daemon-reload
# systemctl enable ccm_data_server.service
# systemctl start ccm_data_server.service
```
