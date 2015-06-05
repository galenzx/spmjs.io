var request = require('request');
var url = require('url');
var models = require('../models');
var anonymous = CONFIG.authorize.type === 'anonymous';
var crypto = require('crypto');
var spmjsioVersion = require('../package').version;
var gitRev = require('git-rev-sync').short();

var githubToken = require('github-token')({
  githubClient: CONFIG.authorize.clientId,
  githubSecret: CONFIG.authorize.clientSecret,
  baseURL: CONFIG.authorize.baseURL,
  callbackURI: 'callback',
  scope: 'empty' // optional, default scope is set to user, have to set a 'empty'
});

exports.index = function(req, res) {
  if (!req.session.user) {
    res.redirect('/');
  } else {
    var profile = req.session.user;
    res.render('account', {
      title: 'My account - ' + CONFIG.website.title,
      spmjsioVersion: spmjsioVersion,
      gitRev: gitRev,
      user: req.session.user,
      anonymous: anonymous,
      GA: CONFIG.website.GA,
      profile: profile,
      ownPackages: models.Account.getPackages(profile.id),
      errormessage: req.query.errormessage
    });
  }
};

exports.user = function(req, res, next) {
  models.Account.getByName(req.params.user, function(user) {
    if (user) {
      var profile = user;
      // not show authkey in public profile
      profile.authkey = null;
      var packages = models.Account.getPackages(profile.id);
      res.render('account', {
        title: user.login + ' - ' + CONFIG.website.title,
        spmjsioVersion: spmjsioVersion,
        gitRev: gitRev,
        user: req.session.user,
        anonymous: anonymous,
        GA: CONFIG.website.GA,
        profile: user,
        ownPackages: packages
      });
    } else {
      next();
    }
  });
};

exports.login = function(req, res) {
  if (!req.session.user) {
    return githubToken.login(req, res);
  } else {
    res.redirect('/');
  }
};

exports.callback = function(req, res) {
  return githubToken.callback(req, res)
    .then(function(token) {
      request.get({
        url: 'https://api.github.com/user?access_token=' + token.access_token,
        headers: {
          'User-Agent': 'spmjs'
        }
      }, function(err, response, body) {
        if (!err && response.statusCode === 200) {
          var user = JSON.parse(body);
          // authkey is the md5 value of github token
          user.authkey = crypto.createHash('md5').update(token.access_token).digest('hex');
          req.session.user = user;
          // save as string
          user.id = user.id.toString();
          // save user to database
          models.Account.update(user, {
            where: {
              id: user.id
            }
          }).then(function() {
            res.redirect('/account');
          });
        }
      });
    });
};

exports.logout = function(req, res) {
  req.session.user = null;
  res.redirect('/');
};

// for spm login
exports.authorize = function(req, res) {
  var name = req.body.account.trim();
  var authkey = req.body.authkey;
  models.Account.authorize(name, authkey, function(result) {
    if (result) {
      res.status(200).send({
        data: authkey
      });
    } else {
      res.status(403).send({
        message: 'username or authkey is wrong.'
      });
    }
  });
};

exports.ownership =  function(req, res) {
  if (!req.session.user) {
    res.status(401).send();
    return;
  }
  var errormessage;
  var action;

  if (req.method === 'POST') {
    action = 'add';
    errormessage = '?errormessage=account ' + req.body.account + ' not existed';
  } else if (req.method === 'DELETE') {
    action = 'remove';
    errormessage = '?errormessage=your are the only owner of ' + req.body.package;
  }

  models.Account[action + 'Package'](req.body.account, req.body.package, function(result) {
    if (result) {
      errormessage = '';
    }
    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      if (errormessage) {
        res.status(403).send({
          errormessage: errormessage
        });
      } else {
        res.status(200).send();
      }
    } else {
      res.redirect(url.parse(req.headers.referer).pathname + errormessage);
    }
  });
};
