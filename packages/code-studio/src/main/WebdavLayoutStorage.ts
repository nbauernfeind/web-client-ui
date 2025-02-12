import { ItemConfigType } from '@deephaven/golden-layout';
import { FileStat, WebDAVClient } from 'webdav/web';
import LayoutStorage from './LayoutStorage';

export class WebdavLayoutStorage implements LayoutStorage {
  readonly client: WebDAVClient;

  readonly root: string;

  /**
   *
   * @param client The WebDAV client instance to use
   * @param root The root path where the layouts are stored
   */
  constructor(client: WebDAVClient, root = '/') {
    this.client = client;
    this.root = root;
  }

  async getLayouts(): Promise<string[]> {
    const files = (await this.client.getDirectoryContents(
      this.root
    )) as FileStat[];

    return files.map(file => file.basename);
  }

  async getLayout(name: string): Promise<ItemConfigType[]> {
    const content = (await this.client.getFileContents(`${this.root}${name}`, {
      format: 'text',
    })) as string;

    return JSON.parse(content);
  }
}

export default WebdavLayoutStorage;
