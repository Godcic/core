const stack = require('./../../module/stack')
const file = require('./../../module/file')
const video = require('./../../module/video')
let logger

class googleDrive {
    /**
     * @param {Int} id driver id
     * @param {Object} driver Google Drive driver instance
     */
    constructor (id, driver) {
        this.id = id
        this.driver = driver

        if (!this.client) throw new Error('Invaild drive instance')
        logger.info('Got drive instance')

        logger = require('./../../module/logger')('Importer: GD ' + id)

        const {
            default: PQueue
        } = require('p-queue')

        this.queue = new PQueue({
            concurrency: 8
        })
    }

    /**
     * Entry for Google Drive importer
     *
     * @param {Boolean} full Scan the whole drive
     *
     * @returns {Promise} Promise queue
     */
    async run (full = false) {
        logger.info('Starting process of import, full =', full)

        const fileList = await this.client.getFileList("name='info.json'", undefined, full)
        logger.info('Got info.json file list')

        fileList.forEach((info) => {
            this.queue.add(() => {
                return new Promise(async (resolve, reject) => {
                    logger.debug('Handling info.json file', info.id)

                    let res = await this.client.downloadFile(info.id)
                    res = res.toString()

                    logger.debug(`File ${info.id}'s content`, res)
                    if (res && JSON.parse(res)) {
                        resolve(await this.handleInfoDotJSON(JSON.parse(res), info))
                        return
                    }

                    logger.error('Invalid file of id', info.id, res)
                    reject(res)
                })
            })
        })

        const result = await this.queue.onEmpty().then(() => {
            logger.info('All Promise settled')
        })

        return result
    }

    /**
     * Handle contents of info.json
     *
     * @param {String} info info.js file content
     * @param {String} fileInfo Google Drive file info
     *
     * @returns {Promise} Video create Promise
     */
    async handleInfoDotJSON (info, fileInfo) {
        const parent = fileInfo.parents[0]

        logger.debug('Video folder id', parent)

        const fileList = await this.client.getFileList(`'${parent}' in parents`)
        logger.debug('Video folder file list', fileList)

        let storyboardId, videoId
        for (const i in fileList) {
            const item = fileList[i]
            if (item.name === 'video.mp4' && (item.size / 1024 / 1024) > 100) videoId = item.id
            if (item.name === 'storyboard') storyboardId = item.id
        }

        logger.debug('Video id', videoId)
        logger.debug('Storyboard folder id', storyboardId)

        const storyboardList = await this.client.getFileList(`'${storyboardId}' in parents`)
        if (storyboardList.length !== 50 || !videoId) {
            logger.info(`Video ${info.hash} havn't fully upload yet`)
            return
        }

        logger.info('Check pass')
        const fileIds = await this.createFileRecord({
            videoId,
            storyboardList,
            info,
            fileInfo
        })

        logger.debug('Files id', fileIds)

        const result = await video.createVideo(info, fileIds)

        return result
    }

    /**
     * Create file records for file bundle
     *
     * @param {Object} data files info
     *
     * @returns {Object} file ids
     */
    async createFileRecord (data) {
        logger.info('Creating file records')
        const prefix = data.info.JAVID + '_'
        const fileIds = {
            metaId: 0,
            videoId: 0,
            storyboardId: {}
        }

        fileIds.metaId = await file.createFileRecord(prefix + 'json', this.id, {
            fileId: data.fileInfo.id
        })

        fileIds.videoId = await file.createFileRecord(prefix + 'video', this.id, {
            fileId: data.videoId
        })

        for (const i in data.storyboardList) {
            const item = data.storyboardList[i]
            fileIds.storyboardId[i] = await file.createFileRecord(prefix + item.name, this.id, {
                fileId: item.id
            })
        }

        return fileIds
    }
}

module.exports = googleDrive
