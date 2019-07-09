/**
 * @overview Javscript module for parsing user access, for working with user_roles.json
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2019
 * @license MIT License
 */

module.exports = {
  createNewUser: _createNewUser,

  isDocOpAllowed: _isDocOpAllowed,

  getPermissions: _getPermissions,

  getDefaultRole: _getDefaultRole,

  getUserInfo: _getUserInfo
};

// require library modules
const helpers     = require( './helpers' );
const mongoOps    = require( './mongodb_operations' );

// get configured user roles
const roleConfigs = require( "../config/user_roles" );

// only support CCM database operations for now
const allowedOperations = roleConfigs.allowed_operations;
const roles = roleConfigs.roles;
const permissions = roleConfigs.permissions;

function _getPermissions( roleName, userName, collectionName, docName ) {
  let permissions = {};
  allowedOperations.forEach( operation => {
    permissions[operation] = _isDocOpAllowed(roleName, userName, collectionName, docName, operation);
  } );
  return permissions;
}

/**
 * @overview document level permission
 * supported keywords:
 *    %all%: permission apply for all collections
 *    %user%: permission apply only for the specific user's collection
 *
 * @param roleName: specifies access level of the user
 * @param username: will be used for matching collection name, each user should have RW access to a collection
 *                  whose name matches their username
 * @param collectionName: name of collection to access
 * @param operation: operation to be performed on the the DB collection
 */
function _isDocOpAllowed( roleName, username, collectionName, docName, operation ) {
  const colPermissions = permissions[ collectionName ]
                       ? permissions[ collectionName ] : permissions[ "collection_default" ];

  // roleName not recognized
  if ( !roles[ roleName ] ) return false;

  // read default permissions and overwrite with user specific permissions
  const defaultDocPermissions = colPermissions[ "document_default" ];
  const docPermissions = Object.assign(
    defaultDocPermissions, colPermissions[ roleName ] ? colPermissions[ roleName ] : {}
  );

  // operation not recognized
  if ( !_isOpAllowed( allowedOperations, operation) ) return false;

  // keyword %all%: operation allowed for all collections
  if ( docPermissions[ "%all%" ] && _isOpAllowed( docPermissions[ "%all%" ], operation ) ) return true;

  // keyword %user%: collection name must match username TODO: can extend to regex match here
  if ( docPermissions[ "%user%" ] && docName === username && _isOpAllowed( docPermissions[ "%user%" ], operation ) )
    return true;

  // document name match
  if ( docPermissions[docName] && _isOpAllowed( docPermissions[docName], operation ) )
    return true;

  return false;
}

function _getDefaultRole() {
    return roleConfigs.default_role;
}

function _isOpAllowed( operations, requestedOp ) {
  for ( let i = 0; i < operations.length; i++ ) {
    if ( operations[i] === requestedOp ) return true;
  }
  return false;
}

/**
 * @overview create new user info document to write to database
 */
function _createNewUser( username, role, token ) {
  // create new user entry if one does not exist
  let userInfo = {
    'key': username,
    'username': username,
    'role': role
  };

  return new Promise( ( resolve, reject ) => {
    // create new salt-hash pair
    helpers.createSaltHashPair( token ).then( saltHashPair => {
        // update userInfo
        Object.assign( userInfo, saltHashPair );
        resolve( userInfo );
      },
      reason => reject( reason )
    );
  } );
}  // end function _createNewUser()

/**
 * @overview manage user information
 * - if user doesn't exist, create a new entry with default value
 * - if user exist, authenticate using received token
 * @return Promise
 *          - onfulfilled param: object containing user information
 *          - onrejected param: rejection reason
 */
function _getUserInfo( mongoInstance, tokenString ) {
  return new Promise( ( resolve, reject ) => {
    mongoInstance.collection( 'users', ( err, collection ) => {
      if ( err ) {
        console.log( "querying for 'users' collection failed" );
        reject( 'server error' );
        return;
      }

      // no user data to verify
      if ( !tokenString ) {
        console.log( 'no user token supplied' );
        reject( 'invalid user info for request' );
        return;
      }

      // parse token string of format '<username>#<token>'
      const tokenChunks = tokenString.split('#');
      if ( tokenChunks.length !== 2 ) return;
      const username = tokenChunks[0];
      const token = tokenChunks[1];

      collection.countDocuments( {}, { limit: 2 }, ( err, count ) => {
        // if no user, create first one as admin
        if ( count === 0 ) {
          _createNewUser( username, 'admin', token ).then (
              newUserInfo => {
                // write new user info to database
                mongoOps.setDataset( collection, newUserInfo ).then(
                    results => mongoOps.getDataset( collection, results.key ).then( userData => resolve( userData ) ),
                    reason => reject( reason )
                );
              },
              reason => reject( reason )
          );
          return;
        }

        // get user info
        mongoOps.getDataset( collection, username ).then( results => {
          let userInfo = results;
          if ( !userInfo ) {
            _createNewUser( username, userOps.getDefaultRole(), token ).then (
                newUserInfo => {
                  // write new user info to database
                  mongoOps.setDataset( collection, newUserInfo ).then(
                      results => mongoOps.getDataset( collection, results.key ).then( userData => resolve( userData ) ),
                      reason => reject( reason )
                  );
                },
                reason => reject( reason )
            );
            return;
          }

          if ( !userInfo.salt || !userInfo.token ) {
            // if no user or no salt/hash for user create new TODO: interface for resetting salt/hash
            helpers.createSaltHashPair( token ).then(
                saltHashPair => {
                  // update userInfo
                  Object.assign( userInfo, saltHashPair );

                  // write new user info to database
                  mongoOps.setDataset( collection, userInfo ).then(
                      results => mongoOps.getDataset( collection, results.key ).then( userData => resolve( userData ) ),
                      reason => reject( reason )
                  );
                },
                reason => reject( reason )
            );
            return;
          }

          // if salt hash doesn't match reject
          helpers.encryptKey( token, userInfo.salt ).then(
            encryptedKey => {
              if ( encryptedKey === userInfo.token )
                resolve( userInfo );
              else
                reject( 'token does not match' );
            },
            reason => reject( reason ) );

        } );  // end mongoOps.getDataset().then()

      } );  // end collection.count()

    } );  // end mongodb.collection()

  })  // end return new Promise()

}  // end _getUserInfo()
