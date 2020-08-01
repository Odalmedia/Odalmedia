const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const http = require('http');
const exphbs  = require('express-handlebars');
const db = require('./private/database.js');
const vd = require('./private/validation.js');
const ms = require('./private/misc.js');
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

// TO IMPORT INITIAL.SQL and TABLE.SQL
// https://www.postgresql-archive.org/pgAdmin-4-How-to-I-import-a-sql-file-td5999352.html

// const httpsOptions = {
// 	cert: fs.readFileSync('./security/www_example_com.crt'),
// 	ca: fs.readFileSync('./security/www_example_com.ca-bundle'),
// 	key: fs.readFileSync('./security/example.key'),
// }

// const httpsServer = https.createServer(httpsOptions, app).listen(port, hostname, () => {
//   console.log('\nServer running at ' + 'https://' + hostname + ":" + port);
// });

http.createServer(app).listen(8080);
console.log("SERVING RUNNING AT: localhost:8080");

app.use(helmet());
app.use(function (req, res, next) {
  res.locals.nonce = crypto.randomBytes(10).toString('hex');
  next();
});

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'", 'maxst.icons8.com'],
    styleSrc: ["'self'", 'maxst.icons8.com', (req, res) => `'nonce-${res.locals.nonce}'`],
		objectSrc: ["'none'"],
		scriptSrc: ["'self'", "'unsafe-inline'", (req, res) => `'nonce-${res.locals.nonce}'`], // add "'strict-dynamic'"
		baseUri: ["'self'"],
  }
}));

app.use(helmet.permittedCrossDomainPolicies());
app.use(helmet.referrerPolicy({ policy: 'same-origin' }))
app.engine('handlebars', exphbs());
app.set('view engine', 'handlebars');
var pgSession = require('connect-pg-simple')(session);
var expireDate = new Date(Date.now() + 60 * 60 * 1000);
app.use(session({
    store: new pgSession({conString: "postgres://" + db.dbUser + ":" + db.dbPass + "@localhost:5432/" + db.dbName}),
    secret: 'makethisasecurepass',
    resave: false,
    saveUninitialized: false,
		cookie: {maxAge: null, secure: false, httpOnly: false},
		autoRemove: 'native',
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', async function(req, res) {
	res.sendFile(path.join(__dirname  + '/public/html/index.html'));
	app.use(express.static("public/css"));
	app.use(express.static("public/images"));
});

app.get('/register', function(req, res) {
	res.sendFile(path.join(__dirname + '/public/html/register.html'));
	app.use(express.static("public/css"));
});

app.post("/register", async (req, res) => {
	try {
	var userExists = await db.checkExistingUser(req.body.Username);
  if (userExists.rowCount >= 1) {
    throw "<h1>Username already exists.</h1>";
  }
	if (req.body.Password != req.body.renteredPassword) {
		throw "<h1>Passwords do not match.</h1>";
	}
	vd.userRequirements(req.body.Username, req.body.Password);
	db.insertUser(req.body.Username, req.body.Password, new Date(), req.ip);
	res.redirect('/login');
	} catch (error) {
		if (typeof(error) == "object") {
		var str = error.message.slice(29, error.length);
		res.status(500).send(str);
		res.end();
	} else if (typeof(error) == "string") {
		res.status(500).send(error);
		res.end();
	}
}
});

app.get('/login', function(req, res) {
	res.sendFile(path.join(__dirname + '/public/html/login.html'));
	app.use(express.static("public/css"));
});

app.post('/login', async function(req, res){
	try {
		var userExists = await db.checkExistingUser(req.body.Username);
		if (req.body.Username == "" || req.body.Password == "") {
			throw '<h1>Empty username or password</h1>';
		} else if (userExists.rowCount == 0) {
			throw `${req.body.Username} not found, please register first`;
		} else {
			db.validateUser(req, res);
			req.session.user = req.body.Username;
			db.updateIpAddress(req);
		}
	} catch (error) {
		res.send(error);
	}
});

app.get('/profile', async function(req, res) {
	 if (vd.verifySession(req)) {
		 app.use(express.static("public/css"));
		 res.render('profile', {
			 layout: false,
			 user: req.session.user,
			 userBio: await db.retrieveUserBio(req.session.user),
		 });
	 } else {
		res.status(403).send("<h1>Please register, login, or enable cookies to access this content.</h1>");
 	}
});

app.get('/profile/customize', function(req, res) {
	if (vd.verifySession(req)) {
		app.use(express.static("public/css"));
		res.render('profile-customize', {layout: false});
	} else {
		res.status(403).send("<h1>Please register, login, or enable cookies to access this content.</h1>");
	}
});

app.post('/profile/update-bio', async function(req, res) {
	await db.updateUserBio(req.body.update_bio, req.session.user);
	res.redirect('/profile');
});

app.get('/search', async function(req, res) {
	if (vd.verifySession(req)) {
		res.render('search',
		{
			layout: false,
			usernames: await db.retrieveAllUsers(),
		});
	app.use(express.static("public/css"));
} else {
	res.status(403).send("<h1>Please register, login, or enable cookies to access this content.</h1>");
}
});

app.post('/search', async function(req, res) {
	res.redirect('/user/' + req.body.usernameSearch);
});


app.get('/logout', async function(req, res) {
  if (vd.verifySession(req)) {
    db.deleteSessions(req.session.user);
    res.redirect('/');
  } else {
    res.sendStatus(403);
  }
});

app.get('/user/:username', async function(req, res) {
  if (vd.verifySession(req)) {
	if (req.params.username == req.session.user) {
		res.redirect('/profile');
	} else {
	var userExists = await db.checkExistingUser(req.params.username);
	if (userExists.rowCount > 0) {
	req.session.lastViewedUser= req.params.username;
	app.use(express.static("public/css"));
	var userFollowingExists = await db.checkUserFollowingExists(req.params.username, req.session.user);
	if (userFollowingExists == 1) {
		res.render('other-profiles-followed', {
			layout: false,
			name: req.params.username,
			userBio: await db.retrieveUserBio(req.params.username),
		});
	} else {
		res.render('other-profiles-unfollowed', {
			layout: false,
			name: req.params.username,
			userBio: await db.retrieveUserBio(req.params.username),
		});
	}
} else {
	res.send("User doesn't exist");
}
}
} else {
  res.sendStatus(403);
}
});

app.get('/profile/following', async function(req, res) {
  if (vd.verifySession(req)) {
	var following = await db.retrieveUserFollowing(req.session.user)
	res.render('user-following',  {
		layout: false,
		userFollowing: following,
	});
} else {
  res.sendStatus(403);
}
});

app.get('/profile/followers', async function(req, res) {
  if (vd.verifySession(req)) {
	var followers = await db.retrieveUserFollowers(req.session.user);
	res.render('user-followers', {
		layout: false,
		userFollowers: followers,
	});
} else {
  res.sendStatus(403);
}
});

app.post('/user/follow', async function(req, res) {
	db.addUserFollower(req.session.user, req.session.lastViewedUser);
	res.redirect('/user/' + req.session.lastViewedUser);
});

app.post('/user/unfollow', async function(req, res) {
	db.removeUserFollower(req.session.user, req.session.lastViewedUser);
	res.redirect('/user/' + req.session.lastViewedUser);
});

app.get('/browser', async function(req, res){
	if (vd.verifySession(req)) {
	var miniverseColumn = await db.listMiniverses();
	var miniverseFollowerCount = await db.listMiniverseFollowerCount();
	app.use(express.static("public/css"));
	res.render('browser', {
		layout: false,
		miniverseColumn: miniverseColumn,
		miniverseFollowerCount: miniverseFollowerCount,
	});
} else {
	res.status(403).send("<h1>Please register, login, or enable cookies to access this content.</h1>");
}
});

app.get('/create/miniverse', async function(req, res) {
	if (vd.verifySession(req)) {
	app.use('/create', express.static(__dirname + '/public/css'));
	res.sendFile(path.join(__dirname + '/public/html/create-miniverse.html'));
} else {
	res.status(403).send("Please register, login, or enable cookies to access this content.");
}
});

app.post('/create/miniverse', async function(req, res) {
	try {
	vd.miniverseCreationForm(req);
	var nameExists = await db.findMiniverseName(req.body.miniverseName);
	if (nameExists > 0) {
		throw "Name already exists";
	}
	var encodedURI = encodeURIComponent(req.body.miniverseName);
	db.createMiniverse(req, encodedURI);
	res.redirect('/browser');
} catch (error) {
	res.send(error);
}
});

app.get('/m/:miniverseName', async function(req, res) {
	if (vd.verifySession(req)) {
	var miniverseExists = await db.findMiniverseName(req.params.miniverseName);
	if (miniverseExists > 0) {
	req.session.lastViewedMiniverse = req.params.miniverseName;
	app.use(express.static('public/js'));
	app.use(express.static('public/css'));
	let miniverseCreatorName = await db.retrieveMiniverseCreatorName(req.params.miniverseName);
	if (miniverseCreatorName == req.session.user) {
		res.render('miniverse-creator', {
			layout: false,
			miniverseName: req.params.miniverseName,
			miniverseCreatorName: miniverseCreatorName,
			miniverseSummary: await db.retrieveMiniverseSummaries(req.params.miniverseName),
			miniverseTopics: await db.topicColumnsOrderedByCreationDate(req.params.miniverseName),
			nonceID: `${res.locals.nonce}`,
		});
	} else {
	var followerExists = await db.checkMiniverseFollowerExists(req.session.user, req.session.lastViewedMiniverse);
	if (followerExists == 1) {
	res.render('miniverse-followed', {
		layout: false,
		miniverseName: req.params.miniverseName,
		miniverseCreatorName: await db.retrieveMiniverseCreatorName(req.params.miniverseName),
	  miniverseSummary: await db.retrieveMiniverseSummaries(req.params.miniverseName),
		miniverseTopics: await db.topicColumnsOrderedByCreationDate(req.params.miniverseName),
		nonceID: `${res.locals.nonce}`,
		});
	} else {
	res.render('miniverse-unfollowed', {
		layout: false,
		miniverseName: req.params.miniverseName,
		miniverseCreatorName: await db.retrieveMiniverseCreatorName(req.params.miniverseName),
		miniverseSummary: await db.retrieveMiniverseSummaries(req.params.miniverseName),
		miniverseTopics: await db.topicColumnsOrderedByCreationDate(req.params.miniverseName),
		nonceID: `${res.locals.nonce}`,
	});
	}
	}
}
} else {
	res.sendStatus(403);
}
});

app.post('/m/delete', async function(req, res) {
	await db.deleteMiniverse(req.session.user, req.session.lastViewedMiniverse);
	res.redirect('/browser');
});

app.get('/m/:miniverseName/topic/:topic', async function(req, res) {

  if (vd.verifySession(req)) {
	app.use(express.static('public/js'));
	app.use(express.static('public/css'));
	req.session.lastViewedTopic = req.params.topic;
	if (await db.retrieveMiniverseTopicCreator(req.params.miniverseName, req.params.topic) == req.session.user) {
		res.render('miniverse-topic-creator', {
			layout: false,
			topicTitle: await db.retrieveMiniverseTopicTitle(req.session.lastViewedMiniverse, req.params.topic),
			topicSummary: await db.retrieveMiniverseTopicSummary(req.session.lastViewedMiniverse, req.params.topic),
			topicCreator: await db.retrieveMiniverseTopicCreator(req.session.lastViewedMiniverse, req.params.topic),
			topicReplies : await db.displayUserTopicReplies(req.params.topic, req.params.miniverseName),
		});
	} else {
	res.render('miniverse-topic', {
		layout: false,
		topicTitle: await db.retrieveMiniverseTopicTitle(req.session.lastViewedMiniverse, req.params.topic),
		topicSummary: await db.retrieveMiniverseTopicSummary(req.session.lastViewedMiniverse, req.params.topic),
		topicCreator: await db.retrieveMiniverseTopicCreator(req.session.lastViewedMiniverse, req.params.topic),
		topicReplies : await db.displayUserTopicReplies(req.params.topic, req.params.miniverseName),
	});
	}
} else {
  res.sendStatus(403);
}
});

app.post('/topic-delete', async function(req, res) {
	await db.deleteMiniverseTopic(req.session.user, req.session.lastViewedMiniverse, req.session.lastViewedTopic);
	res.redirect('/browser');
});

app.post('/create/topic-reply', async function(req, res) {
	if (await db.checkRepliesExist() <= 0) {
		await db.createUserReply(req.body.replyContent, req.session.user, req.session.lastViewedMiniverse, 0, req.session.lastViewedTopic);
	} else {
		let replyID = await db.lastReplyID();
		await db.createUserReply(req.body.replyContent, req.session.user, req.session.lastViewedMiniverse, replyID, req.session.lastViewedTopic);
	}
	res.redirect('/m/' + req.session.lastViewedMiniverse + '/topic/' + req.session.lastViewedTopic);
});

app.post('/reply-delete', async function(req, res) {
	if (req.body.replyCreator == req.session.user) {
	await db.deleteMiniverseTopicReply(req.session.user, req.body.replyID);
	res.redirect('back');
	} else {
	res.send("<h1>This is not your post!<h1>")
	}
});

app.post('/m/follow', function(req, res) {
	db.updateMiniverseFollowers(req);
	res.redirect('/browser');
});

app.post('/m/unfollow', function(req, res) {
db.removeMiniverseFollower(req.session.user, req.session.lastViewedMiniverse);
res.redirect('/browser');
});

app.post('/create/miniverse-post', async function(req, res) {
	if (req.body.topicTitle  == '' || req.body.topicContent == '') {
		res.send("<h1>Please include a title and the content of the post <br> that you are trying to make and try again.</h1>");
	} else {
	if (await db.checkMiniverseTopicsExist(req.session.lastViewedMiniverse) == 0) {
		db.insertMiniverseTopic(req.body.topicTitle, req.body.topicContent, req.session.user, req.session.lastViewedMiniverse, new Date(), 1);
	} else {
		let topicID = await db.lastMiniverseID(req.session.lastViewedMiniverse);
		topicID = parseInt(topicID) + 1;
		db.insertMiniverseTopic(req.body.topicTitle, req.body.topicContent, req.session.user, req.session.lastViewedMiniverse, new Date(), topicID);
	}
	res.redirect('/m/' + req.session.lastViewedMiniverse);
}
});

app.get('/admin', async function(req, res) {
	app.use(express.static('public/css'));
	if (vd.verifySession(req)) {
	if (await db.retrieveUserRole(req.session.user) != "admin") {
		res.sendStatus(403);
	} else {
		res.render('admin-panel', {
			layout: false,
			allUsers: await db.retrieveUsersData(),
			adminUsername: req.session.user,
		});
	}
} else {
	res.sendStatus(401);
}
});

app.get('/chat', function(req, res){
	res.send("Feature is currently disabled.");
})

app.get('/terms-and-conditions', function(req, res) {
	app.use(express.static("public/css"));
	res.sendFile(path.join(__dirname + '/public/html/terms-and-conditions.html'));
});

app.get('/privacy-policy', function(req, res) {
	app.use(express.static("public/css"));
	res.sendFile(path.join(__dirname + '/public/html/privacy-policy.html'));
});
