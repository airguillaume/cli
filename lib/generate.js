let Fs = require('fs');
let Path = require('path');

let Chalk = require('chalk');
let Inquirer = require('inquirer');

let Generate = require('./models').Generate;
let Common = require('./common');
let CONST = require('./const');

let findPackagePromise = (generate) => { //(0)
  	return new Promise((resolve, reject) => {
	    if (generate.path.indexOf(CONST.USER_DIRECTORY) == -1)
			return reject(CONST.ERROR.OUT_OF_SCOPE);
	    while (generate.path != CONST.USER_DIRECTORY){
			if (Fs.existsSync(generate.path + '/package-spm.json')){
				generate.pathPackage = generate.path + '/package-spm.json';
				if (!Fs.existsSync(generate.path + '/spm_modules'))
					return reject('please install a module before using it');
				else
					generate.pathModules = generate.path + '/spm_modules';
				if (Fs.existsSync(generate.path + '/variables-spm.scss'))
					generate.pathVariables = generate.path + '/variables-spm.scss';
				else
					return reject('no variables-spm.scss file found - ');
				return resolve(generate);
			}
			generate.path = generate.path.substring(0, generate.path.lastIndexOf('/'));
		}
		return reject(CONST.ERROR.OUT_OF_SCOPE);
 	});
}

let promptChoiceInListPromise = (list, message, index = 0) => { //Common ?
	return new Promise((resolve, reject) => {
		if (!list || !list.length)
			return reject('incorrect list');
		let questions = [{
			name: 'res',
			type: 'list',
			message,
			choices: list,
			default: list[index]
		}];
		Inquirer.prompt(questions)
		.then(answer => {
			return resolve(answer.res);
		})
		.catch(reject);
	});
}

let selectModulePromise = (generate) => { //(1)
	return new Promise((resolve, reject) => {
		Fs.readdir(`${generate.pathModules}`, (err, files) => {
			if (err)
				return reject(err);
			generate.moduleChoices = [];
			for (let file of files){
				if (Fs.statSync(`${generate.pathModules}/${file}`).isDirectory())
					generate.moduleChoices.push(file)
			}
			if (!generate.moduleChoices.length)
				return reject('no module found in your project');
			if (!generate.classTarget){
				if (generate.name){
					if (!generate.moduleChoices.includes(generate.name)){
						return reject(`module ${generate.name} not found, please install it with "spm install ${generate.name}"`);
					}else{
						generate.moduleName = generate.name;
						return resolve(generate);
					}
				}else{
					promptChoiceInListPromise(generate.moduleChoices, 'select the targeted module')
					.then(res => {
						generate.moduleName = res;
						return resolve(generate);
					})
					.catch(reject);
				}
			}else{
				return resolve(generate);
			}
		});
	});
}

let listAllClassesPromise = (generate, module) => {
	return new Promise((resolve, reject) => {
		Common.getPackageSpmFilePromise(`${generate.pathModules}/${module}/package-spm.json`)
		.then(jsonFile => {
			if (!jsonFile)
				return reject(`issue targeting package.json of module ${module}`);
			for (let item of jsonFile.classes){
				if (!generate.name || generate.name == item.name){
					generate.classChoice.push({module, class: item.name, jsonFile});
					generate.maxLen = generate.maxLen < module.length ? module.length : generate.maxLen;
				}
			}
			return resolve()
		})
		.catch(reject);
	});
}

let selectClassPromise = (generate) => { //(2)
	return new Promise((resolve, reject) => {
		if (!generate.classTarget){
			Common.getPackageSpmFilePromise(`${generate.pathModules}/${generate.moduleName}/package-spm.json`)
			.then(res => {
				if (!res)
					return reject(`issue targeting package-spm.json of module ${generate.moduleName}`);
				generate.jsonFile = res;
				if (!generate.jsonFile.classes.length)
					return reject(`issue in module ${generate.moduleName}: no class found`);
				for (let item of generate.jsonFile.classes)
					item.checked = generate.nickname !== false;
				return resolve(generate);
			})
			.catch(reject);
		}else{
			generate.classChoice = [];
			generate.maxLen = 0;
			let promises = [];
			//on doit lister toutes les classes ici... pas facile !
			for (let module of generate.moduleChoices){
				promises.push(listAllClassesPromise(generate, module));
			}
			Promise.all(promises)
			.then(res => {
				switch (generate.classChoice.length){
					case 0:
						return reject(`no class found`);
					case 1:
						generate.jsonFile = generate.classChoice[0].jsonFile;
						generate.moduleName = generate.classChoice[0].module;
						for (let item of generate.jsonFile.classes){
							if (item.name == generate.classChoice[0].class)
								item.checked = generate.nickname !== false;
							else
								item.checked = false;
						}
						return resolve(generate)
					default:
						let classList = [];
						let classListMapping = {};
						for (let choice of generate.classChoice){
							let display = `${Chalk.hex(CONST.MODULE_COLOR)(choice.module)}${Array(generate.maxLen - choice.module.length + 1).join(' ')} > ${Chalk.hex(CONST.CLASS_COLOR)(choice.class)}`;
							classList.push(display);
							classListMapping[display] = choice;
						}
						promptChoiceInListPromise(classList, 'select the targeted class')
						.then(res => {
							generate.jsonFile = classListMapping[res].jsonFile;
							generate.moduleName = classListMapping[res].module;
							for (let item of generate.jsonFile.classes){
								if (item.name == classListMapping[res].class)
									item.checked = generate.nickname !== false;
								else
									item.checked = false;
							}
							return resolve(generate);
						})
						.catch(reject);
				}
			})
			.catch(reject);
		}
	});
}

let checkInstanceAvailablePromise = (generate) => { //(3)
	return new Promise((resolve, reject) => {
		if (!generate.nickname){
			generate.nickname = generate.jsonFile.name;
		}
		generate.pathInstance = `${generate.pathModules}/${generate.moduleName}/dist/${generate.nickname}.scss`;
		if (Fs.existsSync(generate.pathInstance)){
			if (generate.isForce)
				Fs.unlink(generate.pathInstance, err => {
					if (err)
						return rejecf(err);
					return resolve(generate);
				});
			else
				return reject(`${generate.nickname} instance already exists in module ${generate.moduleName} - use option -f to force`);
		}else{
			return resolve(generate);
		}
	});
}

let replacePrefix = (str, oldPrefix, newPrefix) => {
	if (!str.startsWith(oldPrefix))
		return str;
	else
		return `${newPrefix}${str.substring(oldPrefix.length)}`;
}

let customizeVariablesPromise = (generate) => { //(4)
	return new Promise((resolve, reject) => {
		generate.variablesMap = {};
		generate.nicknames = {};
		for (let item of generate.jsonFile.classes){
			if (item.checked){
				for (let variable of item.variables){
					generate.variablesMap[variable.name] = {from: variable.value};
				}
				generate.nicknames[item.name] = true;
			}
		}
		let questions = [];
		for (let variable in generate.variablesMap){
			questions.push({
				name: variable,
				message: `value of ${variable}`,
				default: generate.variablesMap[variable].from
			});
		}
		if (!questions.length)
			return resolve(generate);
		Inquirer.prompt(questions)
		.then(answer => {
			for (let variable in generate.variablesMap){
				generate.variablesMap[variable].to = answer[variable];
			}
			let nicknamesQuestions = [];
			if (generate.rename){
				for (let nickname in generate.nicknames){
					nicknamesQuestions.push({
						name: nickname,
						message: `instance name to replace ${nickname}`,
						default: replacePrefix(nickname, generate.jsonFile.name, generate.nickname)
					})
				}
			}else{
				nicknamesQuestions.push({
					name: generate.jsonFile.name,
					message: `instance name to replace ${generate.jsonFile.name}`,
					default: generate.nickname
				})
			}
			if (!nicknamesQuestions.length)
				return resolve(generate);
			Inquirer.prompt(nicknamesQuestions)
			.then(answer => {
				for (let className in generate.nicknames){
					generate.nicknames[className] = answer[className] || replacePrefix(className, generate.jsonFile.name, generate.nickname);
				}
				return resolve(generate);
			})
			.catch(reject);
		})
	});
}

let distCreationPromise = (generate) => { //(5)
	return new Promise((resolve, reject) => {
		if (!Fs.existsSync(`${generate.pathModules}/${generate.moduleName}/dist`)){
			Fs.mkdirSync(`${generate.pathModules}/${generate.moduleName}/dist`);
		}
		return resolve(generate);
	});
}

let instanceCreationPromise = (generate) => { //(6)
	return new Promise((resolve, reject) => {
		Fs.readFile(`${generate.pathModules}/${generate.moduleName}/${generate.jsonFile.entry}`, 'utf8', (err, data) => {
			if (err)
				return reject(err);
			//determining the parameters order
			let parameters = '';
			let i = data.indexOf('@mixin spm-');
			i = data.indexOf('(', i);
			let j = data.indexOf(')', i);
			for (let parameter of data.substring(i + 1, j).split(',')){
				parameter = Common.removeWhitespaces(parameter);
				if (parameter.startsWith('$local-'))
					parameters += `${generate.variablesMap[parameter.substring(7)].to || generate.variablesMap[parameter.substring(7)].from},`;
				else if (parameter.startsWith('$mixin-local-'))
					parameters += `'${generate.nicknames[parameter.substring(13)]}',`;
				else
					return reject(`wrong parameter ${parameter} in module entry point file`);
			}
			if (parameters.endsWith(','))
				parameters = parameters.slice(0, -1);
			let output = `@import "../variables-spm.scss";\n@import "../${generate.jsonFile.entry}";\n\n`;
			output += `@include spm-${generate.jsonFile.main}-class(${parameters});\n`;
			Fs.writeFile(`${generate.pathModules}/${generate.moduleName}/dist/${generate.nickname}.scss`, output, err => {
				if (err)
					return reject(err);
				console.log(Chalk.hex(CONST.SUCCESS_COLOR)(`instance ${generate.nickname}.scss of module ${generate.moduleName} has been generated`));
				return resolve(generate);
			});
		});
	});
}

let updateTargetedFilePromise = (generate, item) => {
	return new Promise((resolve, reject) => {
		if (item.endsWith('.css') || item.endsWith('.scss')){
			let target = `${item.startsWith('/') ? '' : generate.path + '/'}${item}`;
			if (Fs.existsSync(target)){
				Fs.readFile(target, 'utf8', (err, data) => {
					if (err)
						return reject(`issue reading the file ${target}`);
					let startIndex = 0;
					let i;
					while ((i = data.indexOf('@import ', startIndex)) >= 0){
						startIndex = data.indexOf(';', i);
						if (startIndex < -1){
							//ERROR MESSAGE INCORRECT IMPORT IN FILE ITEM
							data = null;
							break;
						}
					}
					if (!data){
						data = '';
					}
					if (!startIndex){
						//we use substring 1 because the file will never be a directory and it puts ../ anyway
						data = `@import '${Path.relative(target, generate.pathInstance).substring(1)}';\n${data}`;
					}else{
						// console.log('import found', Path.relative(target, generate.pathInstance));
						data = `${data.substring(0, startIndex + 1)}\n@import '${Path.relative(target, generate.pathInstance).substring(1)}';${data.substring(startIndex +1)}`;
					}
					generate.importFiles.push(item);
					Common.writeFilePromise(target, data)
					.then(resolve)
					.catch(reject);
				});
			}else{
				//WARNING REQUIRED FILE DOESN'T EXIST
				return resolve(generate);
			}
		}
	});
}

let updateUsedFiles = (generate) => { //(7)
	return new Promise((resolve, reject) => {
		if (!generate.use){
			return resolve(generate);
		}else{
			if (generate.use === true){
				generate.use = [`./${generate.jsonFile.entry}`];
			}else{
				generate.use = generate.use.split(' ');
			}
			let promises = [];
			generate.importFiles = [];
			for (let item of generate.use)
				promises.push(updateTargetedFilePromise(generate, item));
			Promise.all(promises)
			.then(() => {
				if (generate.importFiles.length){
					console.log(Chalk.hex(CONST.SUCCESS_COLOR)('instance added in:'));
					for (let importFile of generate.importFiles){
						console.log(Chalk.hex(CONST.SUCCESS_COLOR)(`| ${importFile}`));
					}
				}
			})
			.catch(reject);
		}
	});
}

/* STILL ASKING FOR NAME IF NOT -R AND NICKNAME */

module.exports = (Program) => {
	Program
	.command('generate')
	.alias('g')
	.description('to generate a customized instance of a spm module')
	.arguments('[name] [nickname]')
	.option("-u, --use [path]", 'to use the generated instance in your project')
	.option("-r, --rename", `to modify all classes' names`)
	.option("-C, --class", 'to target a class and not a module')
	.option("-f, --force", 'to force to write the requested instance')
	.action((name, nickname, options) => {
		let generate = new Generate(name, nickname, options, Common.getCurrentPath());
		//0: find package, modules and variables
	   	findPackagePromise(generate)
	   	//1: list Modules
	   	.then(selectModulePromise)
	   	//2: list Classes
	   	.then(selectClassPromise)
	   	//3: validate nickname
	   	.then(checkInstanceAvailablePromise)
	   	//4: modify variables
	   	.then(customizeVariablesPromise)
		//5: creates dist/ directory in it if not already present
		.then(distCreationPromise)
		//6: creates the file in the dist/ directory, can be original instance (zorro) or real instance (zorro-pink)
		.then(instanceCreationPromise)
		//7: if files where it is used were specified  (@import)
		.then(updateUsedFiles)
		// //8: update the package-content -> if dependency is saved, save instance ?
		// .then(packageUpdatePromise)
		.catch(err => {console.log(Chalk.hex(CONST.ERROR_COLOR)(err))});
	})
	.on('--help', function() {
	    console.log('Publishes \'.\' if no argument supplied');
	});
}