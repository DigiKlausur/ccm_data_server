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
* Allow node to bind to SSL port 443 (requires `apt` package `libcap2-bin`)
```
# setcap cap_net_bind_service=+ep `readlink -f \`which node\``
```
* Reload, enable and start the data service
```
# systemctl daemon-reload
# systemctl enable ccm_data_server.service
# systemctl start ccm_data_server.service
```

## User access to collection and documents
Specified in [`user_roles.json`](./config/user_roles.json). Currently 3 roles are supported:
* `admin`
* `grader`
* `student`
TODO(minhnh) need further description of the roles

## Database structure
A sample layout of the database is available in the `resources/question_answers_data.js` on the
[`digklausur/ccm_components`](https://github.com/DigiKlausur/ccm_components) repository.

### `users` collection
Contain user information e.g. user role. No external access by any user roles is possible for this collection
at the moment. In the future, an admin account may get to modify the role for each user.

### Default collection
Currently designed to store question and answer data for a lecture. Supported documents within this collection are
`questions`, `answers`, and a personal document for each user.

#### `questions`
Contain questions created by `grader` and/or `admin`, which are stored in the `entries` field. Each question in
`entries` should be identified by an unique key (e.g. hash of the question text).
```json
{
    _id: 'questions',
    entries: {
        <hash of question text>: {
            text: <question text>,
            last_modified: <last user to write to the question>
        }
    }
}
```

`grader` and `admin` has read/write access to this document, and `student` only has `read` access.

#### `answer_<question_id>`
Contain answers for each question (identified by the `question_id`), as well as the users who ranked the answers.

#### User document
This document is named/identified by the user's username and contains answer for each question by the user. `student`
is allowed write access to this document.
