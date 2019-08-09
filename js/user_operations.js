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

/** @overview get user role for a specific Course ID */
async function _getUserRoleInCourse( mongoInstance, userInfo, courseId ) {
  return new Promise( ( resolve, reject  ) => {
    mongoInstance.collection( 'courses', ( err, courseCollection ) => {
      if ( err ) {
        reject( err );
        return;
      }

      // check if role info for course exist, if not create empty document
      mongoOps.getDataset( courseCollection, courseId )
      .then( courseDoc => {
        if ( !courseDoc ) courseDoc = { 'key': courseId, 'roles': {}, 'collections': {} };

        if ( courseDoc.roles && courseDoc.roles[ userInfo.username ] ) {
          // user exist in course role document => resolve 'userInfo' and return
          userInfo.role = courseDoc.roles[ userInfo.username ];
          return userInfo;
        }

        // user not already in role collection for this class => create new entry
        const userRole = userInfo[ 'is_admin' ] ? 'admin' : _getDefaultRole();
        courseDoc.roles[ userInfo.username ] = userRole;
        userInfo.role = userRole;

        // update course collection with user role info and resolve 'userInfo'
        return mongoOps.setDataset( courseCollection, courseDoc ).then( () => userInfo );
      } )
      .then( userInfo => resolve( userInfo ) );
    } );
  } );
}  // end _getUserRoleInCourse()

/**
 * @overview create new user info document to write to database
 */
async function _createNewUser( userCollection, username, isAdmin, token ) {
  // create new user entry if one does not exist
  let userInfo = {
    'key': username,
    'username': username,
    'is_admin': isAdmin
  };

  return helpers.createSaltHashPair( token )
  .then(
    saltHashPair => {
      Object.assign( userInfo, saltHashPair );
      return userInfo;
    }
  )
  .then(
    async userInfo => {
      // write new user info to user database, and return it as Promise resolution
      return mongoOps.setDataset( userCollection, userInfo ).then( () => { return userInfo; } );
    }
  );
}  // end function _createNewUser()

/**
 * @overview manage user information
 * - if user doesn't exist, create a new entry with default value
 * - if user exist, authenticate using received token
 * @return Promise
 *          - onfulfilled param: object containing user information
 *          - onrejected param: rejection reason
 */
function _getUserInfo( mongoInstance, tokenString, courseId ) {

  return new Promise( ( resolve, reject ) => {

    // no user data to verify
    if ( !tokenString ) {
      console.log( 'no user token supplied' );
      reject( 'invalid user token in request' );
      return;
    }

    // parse token string of format '<username>#<token>'
    const tokenChunks = tokenString.split('#');
    if ( tokenChunks.length !== 2 ) {
      console.log( 'user token has invalid format' );
      reject( 'invalid user token in request' );
      return;
    }
    const username = tokenChunks[0];
    const token = tokenChunks[1];

    // read users document
    mongoInstance.collection( 'users', ( err, userCollection ) => {
      if ( err ) {
        console.log( "querying for 'users' collection failed" );
        reject( 'server error' );
        return;
      }

      userCollection.countDocuments( {}, { limit: 2 }, ( err, count ) => {
        // if no user, create first one as admin
        if ( count === 0 ) {
          _createNewUser( userCollection, username, true, token )
          .then( userInfo => _getUserRoleInCourse( mongoInstance, userInfo, courseId ) )
          .then( userInfo => resolve( userInfo ) );
          return;
        }

        // get user info
        const getUserPromise = mongoOps.getDataset( userCollection, username )
        .then(
          userInfo => {
            if ( !userInfo ) {
              // create a non-admin user
              return _createNewUser( userCollection, username, false, token );
            }
            return userInfo;
          }
        );

        // handle user token
        const handleTokenPromise = getUserPromise.then(
          async userInfo => {
            // if no user or no salt/hash for user create new TODO: interface for resetting salt/hash
            if ( !userInfo.salt || !userInfo.token ) {
              return helpers.createSaltHashPair( token ) .then(
                async saltHashPair => {
                  // update userInfo
                  Object.assign( userInfo, saltHashPair );

                  // write new user info to database
                  return mongoOps.setDataset( userCollection, userInfo ).then( () => userInfo );
                }
              );
            }

            // if salt hash doesn't match reject
            return helpers.encryptKey( token, userInfo.salt ).then(
              encryptedKey => {
                if ( encryptedKey === userInfo.token ) return userInfo;
                else return Promise.reject( 'token does not match' );
              }
            );
        } );

        // get user's role for the course and resolve 'userInfo' or reject
        handleTokenPromise
        .then( userInfo => _getUserRoleInCourse( mongoInstance, userInfo, courseId ) )
        .then( userInfo => resolve( userInfo ), reason => reject( reason ) );

      } );  // end collection.count()

    } );  // end mongodb.collection()

  })  // end return new Promise()

}  // end _getUserInfo()
