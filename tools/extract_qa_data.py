#!/usr/bin/env python3
import argparse
import json
import os
from pymongo import MongoClient


DEFAULT_CONFIG_PATH = 'config/configs.json'
DATABASE_NAME = 'digiklausur'


def main(action, collection_name, database_name, config_file):
    if not os.path.isfile(config_file):
        raise RuntimeError('config path is not a valid file: ' + config_file)
    with open(config_file) as in_file:
        configs = json.load(in_file)

    if not configs['mongo'] or not configs['mongo']['uri'] or not configs['mongo']['port']:
        raise RuntimeError('configurations in {} is invalid:\n{}'.format(config_file, configs))

    client = MongoClient('{}:{}/'.format(configs['mongo']['uri'], configs['mongo']['port']))
    database = client[database_name]
    if action == 'show':
        print('\n'.join(database.list_collection_names()))
        return

    if action == 'extract':
        if not collection_name:
            raise RuntimeError('no collection specified for extraction')
        print("reading collection '{}' from database '{}'".format(collection_name, database_name))
        collection = database.get_collection(collection_name)
        questions_doc = collection.find_one({'_id': 'questions'})
        if not questions_doc:
            raise RuntimeError("collection '{}' has no document 'questions'".format(collection_name))
        if not questions_doc['entries']:
            raise RuntimeError("no entry found in document 'questions'")

        for question_id, question_text in questions_doc['entries'].items():
            print(question_id, question_text, '\n')
            ans_doc = collection.find_one({'_id': 'answers_{}'.format(question_id)})
            if not ans_doc:
                print('no answer document for question: ' + question_id)
                continue
            print(ans_doc)
        return

    raise RuntimeError('unsupported script action: ' + action)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Helper script to extract questions and answers from a MongoDB database')
    parser.add_argument('action', choices=['show', 'extract'],
                        help='show collections or extract question & answers from the specified collection')
    parser.add_argument('--collection', '-c', default=None,
                        help='name of collection to extract answers from')
    parser.add_argument('--config-file', '-f', default=DEFAULT_CONFIG_PATH,
                        help='configuration file for the MongoDB server (default: {})'.format(DEFAULT_CONFIG_PATH))
    parser.add_argument('--database', '-d', default=DATABASE_NAME,
                        help='Name of database containing QA data (default: {})'.format(DATABASE_NAME))
    args = parser.parse_args()
    try:
        main(args.action, args.collection, args.database, args.config_file)
    except Exception as e:
        print(e)
