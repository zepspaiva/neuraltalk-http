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
var path = require('path');
var spawn = require('child_process').spawn;

var PORT = 8080;
var QUEUE_DIR = './queue';
var RESULTS_DIR = './results';

var NEURAL_TALK_2_DIR = '../neuraltalk2';
var NEURAL_TALK_2_DIR_BACK = '../neuraltalk-http/';
var NEURAL_TALK_2_MODEL_FILE = 'model_id1-501-1448236541.t7_cpu.t7';
var NEURAL_TALK_2_USE_GPU = false;
var NEURAL_TALK_2_RESUTL_REGEX = /image\s([0-9]*)\:\s([a-z ]*)/gi;

if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR);
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR);

var deletefolder = function(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

// === NEURALTALK QUEUE

var queues = {}

function ntqueueimg(name, filepath) {

	if (!queues[name]) {
		
		queues[name] = {
			name: name,
			lastevent: (new Date()).getTime(),
			images: [filepath]
		}

	} else {

		var queue = queues[name];

		if (queue.processing) {

			setTimeout(function() {
				ntqueueimg(name, filepath);
			}, 2000);

		} else {

			queue.lastevent = (new Date()).getTime();
			queue.images.push(filepath);

			console.log("Queued", name, filepath)

		}

	}

}

function runneuraltalk2(modelpath, imagepath, imagecount, imagesfiles, queuename, usegpu, callback) {

	var gpuarg = [];
	if (!usegpu) gpuarg = ['-gpuid', '-1'];

	var args = ['eval.lua', '-model', modelpath, '-image_folder', NEURAL_TALK_2_DIR_BACK + imagepath, '-num_images', imagecount];
	for (g in gpuarg)
		args.push(gpuarg[g]);

	var proc = spawn("th", args, { cwd: NEURAL_TALK_2_DIR });

	proc.stdout.on('data', function (data) {
		var match = NEURAL_TALK_2_RESUTL_REGEX.exec(data);
		if (match) {

			var i = parseInt(match[1]);
			var caption = match[2];
			i--;

			fs.writeFile(imagepath + '/' + i + '.json', JSON.stringify({
				caption: caption
			}));

		}
	});

	proc.stderr.on('data', function (data) {
		console.log('stderr: ' + data);
	});

	proc.on('close', function(code) {
	    
		var queuepath = RESULTS_DIR + "/" + queuename;
		if (!fs.existsSync(queuepath)) fs.mkdirSync(queuepath);

		for (var i = 0; i < imagecount; i++) {
			var jsonpath = imagepath + "/" + i + ".json";

			if (fs.existsSync(jsonpath)) {

				var filename = (new Date()).getTime();
				var imagefilepath = imagepath + "/" + imagesfiles[i];

				var newjsonpath = queuepath + "/" + filename + ".json";
				var newimagefilepath = queuepath + "/" + filename + path.extname(imagesfiles[i]);

				fs.renameSync(jsonpath, newjsonpath);
				fs.renameSync(imagefilepath, newimagefilepath);

			}

		}

		deletefolder(imagepath);

		if (callback) callback();

	});

}

function processqueues() {

	for (q in queues) {

		var queue = queues[q];

		if (!queue.processing &&
			queue.images.length > 0 &&
			((new Date()).getTime() - queue.lastevent > 3000 ||
			queue.images.length > 5)) {

			queue.processing = true;

			console.log("Will run:", q, JSON.stringify(queue.images));

			var tempfolder = QUEUE_DIR + "/" + q + "_" + (new Date()).getTime();
			fs.mkdirSync(tempfolder);

			var imagefiles = [];

			for (i in queue.images) {
				imagefiles.push(i + path.extname(queue.images[i]));
				fs.renameSync(queue.images[i], tempfolder + "/" + i + path.extname(queue.images[i]));
			}

			console.log("Moved images:", queue["name"], tempfolder);

			runneuraltalk2(NEURAL_TALK_2_MODEL_FILE, tempfolder, queue.images.length, imagefiles, queue["name"], NEURAL_TALK_2_USE_GPU, function() {

				queue.images = [];
				queue.processing = false;
				console.log("Runned:", queue["name"]);

			});

		}

	}

	setTimeout(function() {
		processqueues();
	}, 2000);

}

processqueues();

// ===

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

	var f = req.query.f
	res.render('upload.html', { f: f });

});

app.post('/upload', multipartMiddleware, function(req, res) {

	var f = req.body.f;
	var base64Data = req.body.imageData;
	var base64Header = base64Data.substr(0, base64Data.indexOf("base64,") + "base64,".length);
	var ext = base64Header.match(/^data:image\/([a-z]+);base64,/)[1];
	if (ext === "jpeg") ext = "jpg";

	base64Data = base64Data.substr(base64Header.length);

	var filepath = QUEUE_DIR + "/" + f + "_" + (new Date()).getTime() + "." + ext;

	fs.writeFile(filepath, base64Data, 'base64', function(err) {
		if (err) res.status(200).send({ success: false });

		ntqueueimg(f, filepath)
		res.status(200).send({ success: true });

	});

});

app.listen(PORT);
console.log('The magic happens on port ' + PORT);