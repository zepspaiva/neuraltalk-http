// === NEURALTALK QUEUE - BEGIN

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

			console.log(caption);

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