var express = require('express');
var app = express();
var flash = require('connect-flash');
var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();

var swig = require('swig');
var morgan = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('express-session');

var fs = require('fs');

var PORT = 3001;
var QUEUE_DIR = './queue';

if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR);

app.use(morgan('dev'));
app.use(cookieParser());
app.use(bodyParser.json({limit: '15mb'}));
app.use(bodyParser.urlencoded({ extended: true }));

app.set('view cache', false);
swig.setDefaults({ cache: false });

app.use(express.static(__dirname + '/web'));
app.engine('html', swig.renderFile);

app.set('view engine', 'html');
app.set('views', __dirname + '/web/swig');

app.use(session({ secret: 'ilovescotchscotchyscotchscotch' }));
app.use(flash());

app.get('/', function(req, res) {

	var path = req.query.path
	res.render('upload.html', { path: path });

});

app.post('/upload', multipartMiddleware, function(req, res) {

	var path = req.body.path;
	var base64Data = req.body.imageData;
	var base64Header = base64Data.substr(0, base64Data.indexOf("base64,") + "base64,".length);
	var ext = base64Header.match(/^data:image\/([a-z]+);base64,/)[1];

	base64Data = base64Data.substr(base64Header.length);

	console.log(path);

	fs.writeFile("out." + ext, base64Data, 'base64', function(err) {
		if (err) res.status(200).send({ success: false });
		res.status(200).send({ success: true });
	});

});

app.listen(PORT);
console.log('The magic happens on port ' + PORT);