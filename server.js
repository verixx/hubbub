  var express = require('express'),
    bodyParser = require('body-parser'),
    marked = require('marked'),
    cors = require('cors'),
    _ = require('underscore'),
    config = require('config'),
    GithubClient = require('./lib/github-client'),
    Commenter = require('./lib/commenter'),
    makeCommentInserter = require('./lib/comment-inserter'),

    app = express(),
    port = process.env.PORT || 44444;

app.use(bodyParser.json());

app.use(cors());

var commentTemplate = _.template(config.get('commentTemplate'));
var sites = config.get('sites');

// Convert a post url path to a source file path within git
function urlPathToSourceFile(urlPath) {
  // TODO: Make this configurable!
  return "_posts/" + urlPath.split('/').slice(-5, -1).join('-') + ".markdown";
}

app.get('/hubbub.js', function (req, res) {
  res.sendFile('./client/hubub.js',
              {
                root: __dirname,
                headers: {
                  'content-type': 'application/javascript'
                }
              });
});

app.param('site', function (req, res, next, siteId) {
  if (_.has(sites, siteId)) {
    req.site = sites[siteId];
    next();
  } else {
    next(new Error("Site not found"));
  }
});

// Post a new comment
app.post('/api/:site/comments', function (req, res) {
  var github = new GithubClient(config.get('commentUser.user'), config.get('commentUser.auth'));
  var commentInserter = makeCommentInserter(req.site.commentsEndMarker);
  var commenter = new Commenter(github, req.site, commentInserter);
  
  var postPath = req.body.post;
  var comment = req.body.comment;
  var metadata = req.body.metadata;
  
  if (!_.isString(comment)) {
    res.status(400).json({error: "Comment is required"});
    return;
  }

  if (!_.isString(postPath)) {
    res.status(400).json({error: "Must specify a post"});
    return;
  }

  if (!metadata || !_.isString(metadata.name)) {
    res.status(400).json({error: "A name is required"});
    return;
  }

  
  var sourcePath = urlPathToSourceFile(postPath);
  var preprocessedComment = commentTemplate({comment: comment, metadata: metadata});

  commenter.createComment(sourcePath, metadata, preprocessedComment)
    .then(function (sentDetails) {
      
      // IDEA: In the future when we support message editing the id
      // should contain an hmac with the secret key. That way the id
      // will be unguessable and we can assume that someone who has
      // the id is the message author.
      res.json({
        html: marked(preprocessedComment),
        update_id: sentDetails.pullRequestNumber
      });
    })
    .catch(function (err) {
      console.error("Failed to save comment: " + (err.message || err.toString()));
      if (err.stacktrace) {
        console.error(err.stacktrace);
      }
      // TODO: Detect errors like missing source files and report them
      res.status(500).json({error: "Failed to save comment"});
      return;
    });
});

app.get('/api/:site/comments', function (req, res) {
  res.redirect("/help");
});

// Comment status, will later also support comment editing and
// deleting
app.get('/api/:site/comments/:id', function (req, res) {
  var id = req.params.id;
  var github = new GithubClient(config.get('commentUser.user'), config.get('commentUser.auth'));

  github.getPullRequest(req.site.user, req.site.repo, id)
    .then(function (pullRequest) {
      console.log(pullRequest);
      var state;
      if (pullRequest.status === 'open') {
        state = "pending";
      } else {
        state = (pullRequest.merged) ? 'accepted' : 'rejected';
      }

      res.json({state: state});
    })
    .catch(function (error) {
      if (error.statusCode === 404) {
        res.status(404).json({error: "Not found"});
      } else {
        res.status(500).json({error: "Failed to retrieve Pull Request details"});
      }
    });
});

app.listen(port, function () {
  console.log('Listening on port ' + port);
});
