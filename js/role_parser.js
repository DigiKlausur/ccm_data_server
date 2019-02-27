/**
 * @overview Javscript module for parsing user access, for working with user_roles.json
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2019
 * @license MIT License
 */

// get configured user roles
const roleConfigs = require( "../config/user_roles" );

// only support CCM database operations for now
const allowedOperations = roleConfigs.allowed_operations;
const roles = roleConfigs.roles;
const permissions = roleConfigs.permissions;

module.exports = {
  isDocOpAllowed: function( roleName, username, collectionName, docName, operation ) {
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
      const colPermissions = permissions[ collectionName ] ?
          permissions[ collectionName ] : permissions[ "collection_default" ];

      // roleName not recognized
      if ( !roles[ roleName ] ) return false;

      // read default permissions and overwrite with user specific permissions
      const defaultDocPermissions = colPermissions[ "document_default" ];
      const docPermissions = Object.assign( defaultDocPermissions,
          colPermissions[ roleName ] ? colPermissions[ roleName ] : {} );

      // operation not recognized
      if ( !isOpAllowed( allowedOperations, operation) ) return false;

      // keyword %all%: operation allowed for all collections
      if ( docPermissions[ "%all%" ] && isOpAllowed( docPermissions[ "%all%" ], operation ) ) return true;

      // keyword %user%: collection name must match username TODO: can extend to regex match here
      if ( docPermissions[ "%user%" ] && docName === username && isOpAllowed( docPermissions[ "%user%" ], operation ) )
          return true;

      // document name match
      if ( docPermissions[docName] && isOpAllowed( docPermissions[docName], operation ) )
          return true;

      return false;
  },

  getPermissions: function( roleName, userName, collectionName, docName ) {
      let permissions = {};
      allowedOperations.forEach( operation => {
          permissions[operation] = this.isDocOpAllowed(roleName, userName, collectionName, docName, operation);
      } );
      return permissions;
  },

  getDefaultRole: function () {
      return roleConfigs.default_role;
  }
};

function isOpAllowed( operations, requestedOp ) {
    for ( let i = 0; i < operations.length; i++ ) {
        if ( operations[i] === requestedOp ) return true;
    }
    return false;
}
